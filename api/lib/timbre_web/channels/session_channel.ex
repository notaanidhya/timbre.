defmodule TimbreWeb.SessionChannel do
  use Phoenix.Channel
  require Logger

  alias Timbre.Sessions

  @impl true
  def join("session:" <> session_id, _payload, socket) do
    send(self(), :after_join)
    {:ok, assign(socket, :session_id, session_id)}
  end

  @impl true
  def handle_info(:after_join, socket) do
    sid = socket.assigns.session_id
    participant = socket.assigns.participant

    broadcast!(socket, "participant_joined", %{
      participant: participant,
      session_id: sid
    })

    # Push current session info to new joiner
    info = Sessions.get_session_info(sid)
    push(socket, "session_state", info)

    {:noreply, socket}
  end

  # First chunk includes client timestamp for timing alignment
  @impl true
  def handle_in("first_chunk", %{"start_ts" => start_ts, "seq" => seq, "chunk" => chunk_b64} = payload, socket) do
    track = Map.get(payload, "track", socket.assigns.participant)

    case Base.decode64(chunk_b64) do
      {:ok, chunk_bin} ->
        Sessions.push_chunk(
          socket.assigns.session_id,
          track,
          start_ts,
          seq,
          chunk_bin
        )

      :error ->
        Logger.warning("Failed to decode base64 first_chunk from #{track}")
    end

    {:noreply, socket}
  end

  # Consecutive audio chunks
  @impl true
  def handle_in("audio_chunk", %{"seq" => seq, "chunk" => chunk_b64} = payload, socket) do
    track = Map.get(payload, "track", socket.assigns.participant)

    case Base.decode64(chunk_b64) do
      {:ok, chunk_bin} ->
        Sessions.push_chunk(
          socket.assigns.session_id,
          track,
          nil,
          seq,
          chunk_bin
        )

      :error ->
        Logger.warning("Failed to decode base64 audio_chunk from #{track}")
    end

    {:noreply, socket}
  end

  # Real-time volume level signal for remote LED meters (zero audio loopback feedback)
  @impl true
  def handle_in("level", %{"level" => level} = payload, socket) do
    track = Map.get(payload, "track", socket.assigns.participant)

    broadcast_from!(socket, "peer_level", %{
      participant: track,
      level: level
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("participant_done", payload, socket) do
    track = Map.get(payload, "track", socket.assigns.participant)
    Sessions.mark_done(socket.assigns.session_id, track)

    broadcast!(socket, "participant_done", %{
      participant: track
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("add_take", %{"track" => track}, socket) do
    sid = socket.assigns.session_id
    Sessions.add_track(sid, track)

    broadcast!(socket, "participant_joined", %{
      participant: track,
      session_id: sid
    })

    info = Sessions.get_session_info(sid)
    broadcast!(socket, "session_state", info)

    {:noreply, socket}
  end

  @impl true
  def handle_in("reset_take", payload, socket) do
    sid = socket.assigns.session_id
    track = Map.get(payload, "track", socket.assigns.participant)
    Sessions.reset_track(sid, track)

    info = Sessions.get_session_info(sid)
    broadcast!(socket, "session_state", info)

    {:noreply, socket}
  end

  # Triggers server-side timing-aligned merge
  @impl true
  def handle_in("merge_now", _payload, socket) do
    sid = socket.assigns.session_id

    case Sessions.merge_and_save(sid) do
      {:ok, recording} ->
        broadcast!(socket, "merge_complete", %{
          recording_id: recording.id,
          title: recording.title,
          duration_ms: recording.duration_ms
        })

        {:reply, {:ok, %{recording_id: recording.id}}, socket}

      {:error, reason} ->
        push(socket, "merge_error", %{reason: inspect(reason)})
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end
end
