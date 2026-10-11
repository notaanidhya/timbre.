defmodule TimbreWeb.RecordingsController do
  use TimbreWeb, :controller

  alias Timbre.Recordings

  def index(conn, _params) do
    recordings = Recordings.list_recordings()
    json(conn, %{recordings: recordings})
  end

  def create(conn, params) do
    {blob, upload_content_type} =
      case params["blob"] do
        %Plug.Upload{path: path, content_type: ct} ->
          {File.read!(path), ct}

        raw_binary when is_binary(raw_binary) ->
          {raw_binary, nil}

        _ ->
          {nil, nil}
      end

    content_type = params["content_type"] || upload_content_type || "audio/webm"
    title = Map.get(params, "title", "Untitled")
    duration_ms = parse_int(params["duration_ms"])
    sample_rate = parse_int(params["sample_rate"])
    size_bytes = if blob, do: byte_size(blob), else: nil

    attrs = %{
      title: title,
      blob: blob,
      content_type: content_type,
      duration_ms: duration_ms,
      size_bytes: size_bytes,
      sample_rate: sample_rate,
      session_id: params["session_id"],
      participant: params["participant"]
    }

    case Recordings.create_recording(attrs) do
      {:ok, recording} ->
        conn
        |> put_status(:created)
        |> json(%{
          id: recording.id,
          title: recording.title,
          duration_ms: recording.duration_ms,
          size_bytes: recording.size_bytes,
          content_type: recording.content_type,
          sample_rate: recording.sample_rate
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def audio(conn, %{"id" => id}) do
    recording = Recordings.get_recording!(id)

    conn
    |> put_resp_content_type(recording.content_type)
    |> put_resp_header("content-disposition", ~s(inline; filename="recording-#{id}"))
    |> send_resp(200, recording.blob)
  end

  def delete(conn, %{"id" => id}) do
    recording = Recordings.get_recording!(id)

    with {:ok, _recording} <- Recordings.delete_recording(recording) do
      send_resp(conn, :no_content, "")
    end
  end

  defp parse_int(nil), do: nil
  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {int, _} -> int
      :error -> nil
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
  end
end
