defmodule Timbre.Recordings do
  @moduledoc """
  The Recordings context.
  """

  import Ecto.Query, warn: false
  alias Timbre.Repo
  alias Timbre.Recordings.Recording
  alias Timbre.Recordings.Transcript

  @doc """
  Returns the list of recordings without loading the large binary blob.
  """
  def list_recordings do
    Repo.all(
      from r in Recording,
        select: %{
          id: r.id,
          title: r.title,
          duration_ms: r.duration_ms,
          size_bytes: r.size_bytes,
          content_type: r.content_type,
          sample_rate: r.sample_rate,
          session_id: r.session_id,
          participant: r.participant,
          inserted_at: r.inserted_at,
          updated_at: r.updated_at
        },
        order_by: [desc: r.inserted_at]
    )
  end

  @doc """
  Gets a single recording by id with the binary blob included.
  Raises Ecto.NoResultsError if not found.
  """
  def get_recording!(id), do: Repo.get!(Recording, id)

  @doc """
  Creates a recording.
  """
  def create_recording(attrs \\ %{}) do
    %Recording{}
    |> Recording.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Deletes a recording.
  """
  def delete_recording(%Recording{} = recording) do
    Repo.delete(recording)
  end

  @doc """
  Returns a transcript for a given recording id, or nil if none exists.
  """
  def get_transcript_for(recording_id) do
    Repo.get_by(Transcript, recording_id: recording_id)
  end

  @doc """
  Upserts a transcript for a given recording id.
  """
  def upsert_transcript(recording_id, attrs) do
    transcript = get_transcript_for(recording_id) || %Transcript{recording_id: recording_id}

    transcript
    |> Transcript.changeset(Map.put(attrs, :recording_id, recording_id))
    |> Repo.insert_or_update()
  end
end
