defmodule TimbreWeb.UserSocket do
  use Phoenix.Socket

  channel "session:*", TimbreWeb.SessionChannel

  @impl true
  def connect(params, socket, _connect_info) do
    participant = Map.get(params, "participant") || "Anonymous"
    {:ok, assign(socket, :participant, participant)}
  end

  @impl true
  def id(_socket), do: nil
end
