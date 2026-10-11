defmodule Timbre.Repo.Migrations.CreateRecordings do
  use Ecto.Migration

  def change do
    create table(:recordings) do
      add :title, :string, null: false, default: "Untitled"
      add :duration_ms, :integer
      add :size_bytes, :integer
      add :content_type, :string, null: false
      add :blob, :binary, null: false
      add :sample_rate, :integer
      add :session_id, :string
      add :participant, :string

      timestamps()
    end
  end
end
