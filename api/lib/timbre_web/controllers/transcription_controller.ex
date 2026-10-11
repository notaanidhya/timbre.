defmodule TimbreWeb.TranscriptionController do
  use TimbreWeb, :controller

  alias Timbre.Recordings
  alias Timbre.TranscriptionWorker

  def create(conn, %{"id" => id}) do
    recording_id = String.to_integer(id)
    _recording = Recordings.get_recording!(recording_id)

    {:ok, _transcript} =
      Recordings.upsert_transcript(recording_id, %{
        status: "pending",
        error: nil
      })

    TranscriptionWorker.transcribe_async(recording_id)

    conn
    |> put_status(:accepted)
    |> json(%{status: "accepted", recording_id: recording_id})
  end

  def show(conn, %{"id" => id}) do
    recording_id = String.to_integer(id)

    case Recordings.get_transcript_for(recording_id) do
      nil ->
        json(conn, %{
          status: "not_requested",
          text: nil,
          summary: nil,
          title: nil,
          error: nil
        })

      transcript ->
        json(conn, %{
          status: transcript.status,
          text: transcript.text,
          summary: transcript.summary,
          title: transcript.title,
          error: transcript.error
        })
    end
  end
end
