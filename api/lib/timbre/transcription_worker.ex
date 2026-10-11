defmodule Timbre.TranscriptionWorker do
  @moduledoc """
  Asynchronous worker that transcribes and summarizes audio recordings
  using Gemini multimodal audio understanding.
  """

  require Logger
  alias Timbre.Recordings

  @gemini_api_base "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"

  @doc """
  Spawns an asynchronous transcription task under the TranscriptionSupervisor.
  """
  def transcribe_async(recording_id, opts \\ []) do
    Task.Supervisor.start_child(Timbre.TranscriptionSupervisor, fn ->
      do_transcribe(recording_id, opts)
    end)
  end

  defp do_transcribe(recording_id, opts) do
    Recordings.upsert_transcript(recording_id, %{status: "processing"})
    recording = Recordings.get_recording!(recording_id)

    api_key =
      Keyword.get(opts, :api_key) ||
        System.get_env("GEMINI_API_KEY") ||
        read_key_from_env_file()

    url = Keyword.get(opts, :url) || "#{@gemini_api_base}?key=#{api_key}"

    case call_gemini(recording, url) do
      {:ok, %{"title" => title, "summary" => summary, "text" => text}} ->
        Recordings.upsert_transcript(recording_id, %{
          status: "done",
          title: title,
          summary: summary,
          text: text
        })

        Phoenix.PubSub.broadcast(Timbre.PubSub, "transcript:#{recording_id}", :done)

      {:error, reason} ->
        Logger.error("Transcription failed for recording #{recording_id}: #{inspect(reason)}")
        Recordings.upsert_transcript(recording_id, %{status: "error", error: inspect(reason)})
    end
  rescue
    e ->
      Logger.error("Exception in transcription worker: #{inspect(e)}")
      Recordings.upsert_transcript(recording_id, %{status: "error", error: Exception.message(e)})
  end

  defp call_gemini(recording, url) do
    mime_type = clean_mime_type(recording.content_type)
    b64_data = Base.encode64(recording.blob)

    prompt = """
    Transcribe this audio recording verbatim.
    Also generate a concise, descriptive title (maximum 8 words) and a 2-3 sentence summary.
    Return ONLY a valid JSON object matching this exact schema:
    {
      "title": "short descriptive title",
      "summary": "2-3 sentence summary",
      "text": "full verbatim transcript"
    }
    """

    payload = %{
      contents: [
        %{
          parts: [
            %{text: prompt},
            %{
              inline_data: %{
                mime_type: mime_type,
                data: b64_data
              }
            }
          ]
        }
      ],
      generationConfig: %{
        response_mime_type: "application/json"
      }
    }

    case Req.post(url, json: payload, receive_timeout: 120_000) do
      {:ok, %{status: 200, body: body}} ->
        parse_gemini_response(body)

      {:ok, %{status: status, body: body}} ->
        {:error, "Gemini HTTP #{status}: #{inspect(body)}"}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp parse_gemini_response(%{"candidates" => [%{"content" => %{"parts" => [%{"text" => raw_json} | _]}} | _]}) do
    case Jason.decode(raw_json) do
      {:ok, parsed} when is_map(parsed) ->
        {:ok, %{
          "title" => Map.get(parsed, "title", "Untitled Recording"),
          "summary" => Map.get(parsed, "summary", "No summary provided."),
          "text" => Map.get(parsed, "text", "")
        }}

      _ ->
        {:error, "Failed to decode Gemini JSON response: #{raw_json}"}
    end
  end

  defp parse_gemini_response(other) do
    {:error, "Unexpected Gemini response structure: #{inspect(other)}"}
  end

  defp clean_mime_type(ct) when is_binary(ct) do
    cond do
      String.contains?(ct, "ogg") -> "audio/ogg"
      String.contains?(ct, "wav") -> "audio/wav"
      true -> "audio/webm"
    end
  end

  defp clean_mime_type(_), do: "audio/webm"

  defp read_key_from_env_file do
    case File.read(Path.expand("../.env", __DIR__)) do
      {:ok, content} ->
        content
        |> String.split("\n")
        |> Enum.find_value(fn line ->
          case String.split(String.trim(line), "=", parts: 2) do
            ["GEMINI_API_KEY", key] -> String.trim(key)
            _ -> nil
          end
        end)

      _ ->
        nil
    end
  end
end
