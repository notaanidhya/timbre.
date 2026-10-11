defmodule TimbreWeb.RecordingsControllerTest do
  use TimbreWeb.ConnCase

  alias Timbre.Recordings

  @valid_blob <<0, 1, 2, 3, 4, 5, 6, 7>>

  describe "index" do
    test "lists all recordings", %{conn: conn} do
      conn = get(conn, ~p"/api/recordings")
      assert json_response(conn, 200) == %{"recordings" => []}
    end

    test "lists recordings without blob data", %{conn: conn} do
      {:ok, recording} =
        Recordings.create_recording(%{
          title: "Test Voice",
          blob: @valid_blob,
          content_type: "audio/webm",
          duration_ms: 1200,
          sample_rate: 48_000
        })

      conn = get(conn, ~p"/api/recordings")
      [item] = json_response(conn, 200)["recordings"]

      assert item["id"] == recording.id
      assert item["title"] == "Test Voice"
      assert item["duration_ms"] == 1200
      assert item["sample_rate"] == 48_000
      assert item["content_type"] == "audio/webm"
      refute Map.has_key?(item, "blob")
    end
  end

  describe "create recording" do
    test "creates recording with multipart upload", %{conn: conn} do
      # Create a temporary file for Plug.Upload
      tmp_path = Plug.Upload.random_file!("audio")
      File.write!(tmp_path, @valid_blob)

      upload = %Plug.Upload{
        path: tmp_path,
        filename: "test.webm",
        content_type: "audio/webm"
      }

      conn =
        post(conn, ~p"/api/recordings", %{
          "blob" => upload,
          "title" => "Sample Mic",
          "duration_ms" => "2500",
          "sample_rate" => "44100"
        })

      assert %{
               "id" => id,
               "title" => "Sample Mic",
               "duration_ms" => 2500,
               "sample_rate" => 44_100,
               "content_type" => "audio/webm"
             } = json_response(conn, 201)

      saved = Recordings.get_recording!(id)
      assert saved.blob == @valid_blob
    end

    test "renders errors when required fields are missing", %{conn: conn} do
      conn = post(conn, ~p"/api/recordings", %{"title" => "No Blob"})
      assert json_response(conn, 422)["errors"] != nil
    end
  end

  describe "audio streaming" do
    test "streams raw audio binary with correct headers", %{conn: conn} do
      {:ok, recording} =
        Recordings.create_recording(%{
          title: "Stream Me",
          blob: @valid_blob,
          content_type: "audio/ogg",
          duration_ms: 1000
        })

      conn = get(conn, ~p"/api/recordings/#{recording.id}/audio")

      assert response(conn, 200) == @valid_blob
      assert response_content_type(conn, :ogg) =~ "audio/ogg"
      assert get_resp_header(conn, "content-disposition") == [~s(inline; filename="recording-#{recording.id}")]
    end
  end

  describe "delete recording" do
    test "deletes chosen recording", %{conn: conn} do
      {:ok, recording} =
        Recordings.create_recording(%{
          title: "Delete Me",
          blob: @valid_blob,
          content_type: "audio/webm"
        })

      conn = delete(conn, ~p"/api/recordings/#{recording.id}")
      assert response(conn, 204) == ""

      assert_raise Ecto.NoResultsError, fn ->
        Recordings.get_recording!(recording.id)
      end
    end
  end
end
