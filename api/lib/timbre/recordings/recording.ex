defmodule Timbre.Recordings.Recording do
  use Ecto.Schema
  import Ecto.Changeset

  schema "recordings" do
    field :title, :string, default: "Untitled"
    field :duration_ms, :integer
    field :size_bytes, :integer
    field :content_type, :string
    field :blob, :binary
    field :sample_rate, :integer
    field :session_id, :string
    field :participant, :string

    has_one :transcript, Timbre.Recordings.Transcript

    timestamps()
  end

  @doc false
  def changeset(recording, attrs) do
    recording
    |> cast(attrs, [
      :title,
      :duration_ms,
      :size_bytes,
      :content_type,
      :blob,
      :sample_rate,
      :session_id,
      :participant
    ])
    |> validate_required([:content_type, :blob])
    |> validate_length(:title, max: 200)
  end
end
