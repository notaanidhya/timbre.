defmodule Timbre.WavEncoder do
  @moduledoc """
  Pure Elixir 16-bit PCM WAV encoder and decoder.
  Zero external dependencies (no ffmpeg required).
  Uses binary comprehensions for high-throughput stream processing.
  """

  @doc """
  Encodes a list of float PCM samples (-1.0 to 1.0) into a standard 16-bit PCM WAV binary.
  Includes pre-clamping to [-1.0, 1.0] to prevent audio wrap-around distortion.
  """
  @spec encode([float()], pos_integer(), pos_integer()) :: binary()
  def encode(samples, sample_rate \\ 48_000, channels \\ 1) do
    pcm =
      for s <- samples, into: <<>> do
        v = s |> max(-1.0) |> min(1.0)
        int16 = if v < 0, do: round(v * 32_768), else: round(v * 32_767)
        <<int16::signed-16-little>>
      end

    data_size = byte_size(pcm)
    wav_header(data_size, sample_rate, channels) <> pcm
  end

  @doc """
  Decodes raw 16-bit little-endian binary PCM into a list of normalized floats (-1.0 to 1.0).
  """
  @spec decode_int16(binary()) :: [float()]
  def decode_int16(binary) when is_binary(binary) do
    for <<s::signed-16-little <- binary>> do
      if s < 0, do: s / 32_768.0, else: s / 32_767.0
    end
  end

  defp wav_header(data_size, sr, ch) do
    block_align = ch * 2
    byte_rate = sr * block_align

    <<
      "RIFF",
      (data_size + 36)::32-little,
      "WAVE",
      "fmt ",
      16::32-little,
      1::16-little,
      ch::16-little,
      sr::32-little,
      byte_rate::32-little,
      block_align::16-little,
      16::16-little,
      "data",
      data_size::32-little
    >>
  end
end
