defmodule Timbre.Sessions do
  @moduledoc """
  Supervised GenServer that buffers live participant audio chunks for multiplayer
  recording sessions and performs timing-aligned master audio merging.
  """

  use GenServer
  require Logger

  alias Timbre.Recordings
  alias Timbre.WavEncoder

  @sample_rate 48_000

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, %{}, Keyword.put_new(opts, :name, __MODULE__))
  end

  @doc """
  Pushes an audio chunk for a participant in a session.
  """
  def push_chunk(session_id, participant, start_ts, seq, chunk_bin) do
    GenServer.cast(__MODULE__, {:push, session_id, participant, start_ts, seq, chunk_bin})
  end

  @doc """
  Marks a participant's take as completed.
  """
  def mark_done(session_id, participant) do
    GenServer.cast(__MODULE__, {:done, session_id, participant})
  end

  @doc """
  Returns metadata about active participants in a session.
  """
  def get_session_info(session_id) do
    GenServer.call(__MODULE__, {:get_info, session_id})
  end

  @doc """
  Adds a new take/track to a session.
  """
  def add_track(session_id, track) do
    GenServer.cast(__MODULE__, {:add_track, session_id, track})
  end

  @doc """
  Resets a track's audio chunks and completion status for re-recording.
  """
  def reset_track(session_id, track) do
    GenServer.cast(__MODULE__, {:reset_track, session_id, track})
  end

  @doc """
  Merges all participant audio streams, aligns timestamps, writes a master WAV,
  and persists it to the recordings database.
  """
  def merge_and_save(session_id) do
    GenServer.call(__MODULE__, {:merge, session_id}, 45_000)
  end

  # Server Callbacks

  @impl true
  def init(_) do
    {:ok, %{}}
  end

  @impl true
  def handle_cast({:push, sid, participant, start_ts, seq, chunk}, state) do
    current_time = System.system_time(:millisecond)
    effective_ts = start_ts || current_time

    session = Map.get(state, sid, %{})
    participant_data = Map.get(session, participant, %{chunks: [], done: false, start_ts: effective_ts})

    updated_participant = %{
      participant_data
      | chunks: [{seq, chunk} | participant_data.chunks],
        start_ts: participant_data.start_ts || effective_ts
    }

    new_state = put_in(state, [sid, participant], updated_participant)
    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:done, sid, participant}, state) do
    new_state =
      if get_in(state, [sid, participant]) do
        put_in(state, [sid, participant, :done], true)
      else
        state
      end

    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:add_track, sid, track}, state) do
    session = Map.get(state, sid, %{})
    track_data = Map.get(session, track, %{chunks: [], done: false, start_ts: nil})
    new_state = put_in(state, [sid, track], track_data)
    {:noreply, new_state}
  end

  @impl true
  def handle_cast({:reset_track, sid, track}, state) do
    new_state =
      if get_in(state, [sid, track]) do
        put_in(state, [sid, track], %{chunks: [], done: false, start_ts: nil})
      else
        state
      end

    {:noreply, new_state}
  end

  @impl true
  def handle_call({:get_info, sid}, _from, state) do
    session = Map.get(state, sid, %{})
    participants =
      Enum.map(session, fn {name, data} ->
        %{
          name: name,
          chunks_count: length(data.chunks),
          done: data.done,
          start_ts: data.start_ts
        }
      end)

    {:reply, %{session_id: sid, participants: participants}, state}
  end

  @impl true
  def handle_call({:merge, sid}, _from, state) do
    case Map.get(state, sid) do
      nil ->
        {:reply, {:error, :session_not_found}, state}

      participants when map_size(participants) == 0 ->
        {:reply, {:error, :no_participants}, state}

      participants ->
        case do_merge(sid, participants) do
          {:ok, recording} ->
            # Clean up buffer after successful merge
            {:reply, {:ok, recording}, Map.delete(state, sid)}

          {:error, _} = err ->
            {:reply, err, state}
        end
    end
  end

  # Internal Merge Engine

  defp do_merge(sid, participants) do
    # 1. Collect and sort chunks per participant, decode Int16 to float samples
    streams =
      Enum.map(participants, fn {name, %{chunks: chunks, start_ts: start_ts}} ->
        sorted_chunks =
          chunks
          |> Enum.sort_by(fn {seq, _bin} -> seq end)
          |> Enum.map(fn {_seq, bin} -> bin end)

        pcm_samples =
          Enum.flat_map(sorted_chunks, fn bin ->
            WavEncoder.decode_int16(bin)
          end)

        %{name: name, start_ts: start_ts, samples: pcm_samples}
      end)

    valid_streams = Enum.filter(streams, fn s -> length(s.samples) > 0 end)

    if Enum.empty?(valid_streams) do
      {:error, :empty_audio_streams}
    else
      # 2. Timing alignment: calculate delay relative to the earliest participant
      min_ts = valid_streams |> Enum.map(& &1.start_ts) |> Enum.min()

      aligned_tracks =
        Enum.map(valid_streams, fn s ->
          raw_delay_ms = max(0, s.start_ts - min_ts)
          # If delay is > 4000ms (e.g. overdub / second take pass), align to 0 so layers sync cleanly
          delay_ms = if raw_delay_ms > 4_000, do: 0, else: raw_delay_ms
          pad_samples_count = round(delay_ms * @sample_rate / 1000)
          List.duplicate(0.0, pad_samples_count) ++ s.samples
        end)

      # 3. Sum and mix overlapping tracks with sample-level clamping
      max_len = aligned_tracks |> Enum.map(&length/1) |> Enum.max()

      # Mix into final float list
      track_count = length(aligned_tracks)
      mixed_samples =
        for i <- 0..(max_len - 1) do
          sum =
            Enum.reduce(aligned_tracks, 0.0, fn track, acc ->
              acc + (Enum.at(track, i) || 0.0)
            end)

          # Normalize slightly for multiple voices while clamping to [-1.0, 1.0]
          normalized = if track_count > 1, do: sum * 0.85, else: sum
          max(-1.0, min(1.0, normalized))
        end

      # 4. Encode to 16-bit PCM WAV
      wav_blob = WavEncoder.encode(mixed_samples, @sample_rate, 1)
      duration_ms = round(max_len * 1000 / @sample_rate)

      Recordings.create_recording(%{
        title: "Merged Session #{sid}",
        blob: wav_blob,
        content_type: "audio/wav",
        duration_ms: duration_ms,
        size_bytes: byte_size(wav_blob),
        sample_rate: @sample_rate,
        session_id: sid
      })
    end
  end
end
