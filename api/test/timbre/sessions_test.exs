defmodule Timbre.SessionsTest do
  use TimbreWeb.ConnCase

  alias Timbre.Sessions
  alias Timbre.Recordings

  setup do
    # Ensure Sessions GenServer is started
    case GenServer.whereis(Sessions) do
      nil -> start_supervised!(Sessions)
      _pid -> :ok
    end

    :ok
  end

  describe "Sessions multiplayer workflow" do
    test "buffers chunks from multiple participants and merges with alignment" do
      session_id = "test-room-#{System.unique_integer([:positive])}"

      # Chunk A (starts at t = 1000)
      chunk_a = <<10_000::signed-16-little, 15_000::signed-16-little>>
      Sessions.push_chunk(session_id, "Alice", 1000, 1, chunk_a)

      # Chunk B (starts at t = 1010, 10ms later)
      chunk_b = <<8_000::signed-16-little, 12_000::signed-16-little>>
      Sessions.push_chunk(session_id, "Bob", 1010, 1, chunk_b)

      info = Sessions.get_session_info(session_id)
      assert length(info.participants) == 2

      # Merge session into database recording
      {:ok, recording} = Sessions.merge_and_save(session_id)

      assert recording.id != nil
      assert recording.session_id == session_id
      assert recording.content_type == "audio/wav"
      assert recording.size_bytes > 44

      # Verify it is persisted in Recordings
      persisted = Recordings.get_recording!(recording.id)
      assert persisted.id == recording.id
      assert persisted.title =~ "Merged Session"
    end
  end
end
