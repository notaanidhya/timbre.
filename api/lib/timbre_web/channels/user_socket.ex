defmodule TimbreWeb.UserSocket do
  use Phoenix.Socket

  channel "session:*", TimbreWeb.SessionChannel

  @impl true
  def connect(params, socket, _connect_info) do
    participant = Map.get(params, "participant") || "Anonymous"
    client_id = Map.get(params, "client_id")

    socket =
      socket
      |> assign(:participant, participant)
      |> assign(:client_id, client_id)

    {:ok, socket}
  end

  @impl true
  def id(_socket), do: nil
end
