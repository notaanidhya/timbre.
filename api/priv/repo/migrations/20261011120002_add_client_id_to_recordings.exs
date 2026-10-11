defmodule Timbre.Repo.Migrations.AddClientIdToRecordings do
  use Ecto.Migration

  def change do
    alter table(:recordings) do
      add :client_id, :string
    end
  end
end
