defmodule Timbre.Repo.Migrations.CreateTranscripts do
  use Ecto.Migration

  def change do
    create table(:transcripts) do
      add :recording_id, references(:recordings, on_delete: :delete_all), null: false
      add :text, :text
      add :summary, :text
      add :title, :string
      add :status, :string, null: false, default: "pending"
      add :error, :string

      timestamps()
    end

    create unique_index(:transcripts, [:recording_id])
  end
end
