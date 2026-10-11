defmodule Timbre.Recordings.Transcript do
  use Ecto.Schema
  import Ecto.Changeset

  schema "transcripts" do
    field :text, :string
    field :summary, :string
    field :title, :string
    field :status, :string, default: "pending"
    field :error, :string

    belongs_to :recording, Timbre.Recordings.Recording

    timestamps()
  end

  @doc false
  def changeset(transcript, attrs) do
    transcript
    |> cast(attrs, [:recording_id, :text, :summary, :title, :status, :error])
    |> validate_required([:recording_id, :status])
    |> validate_inclusion(:status, ~w(pending processing done error))
    |> foreign_key_constraint(:recording_id)
  end
end
