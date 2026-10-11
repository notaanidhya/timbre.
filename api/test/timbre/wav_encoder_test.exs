defmodule Timbre.WavEncoderTest do
  use ExUnit.Case, async: true

  alias Timbre.WavEncoder

  describe "encode/3" do
    test "encodes samples with valid RIFF header" do
      samples = [0.0, 0.5, -0.5, 1.0, -1.0]
      wav = WavEncoder.encode(samples, 48_000, 1)

      assert byte_size(wav) == 44 + 5 * 2
      assert binary_part(wav, 0, 4) == "RIFF"
      assert binary_part(wav, 8, 4) == "WAVE"
      assert binary_part(wav, 12, 4) == "fmt "
      assert binary_part(wav, 36, 4) == "data"
    end

    test "clamps samples to prevent wrap-around noise" do
      oversaturated = [2.5, -3.0]
      wav = WavEncoder.encode(oversaturated, 48_000, 1)
      pcm = binary_part(wav, 44, 4)

      # 2.5 clamped to 1.0 -> 32767
      # -3.0 clamped to -1.0 -> -32768
      assert <<32_767::signed-16-little, -32_768::signed-16-little>> == pcm
    end
  end

  describe "decode_int16/1" do
    test "decodes binary Int16 samples back to normalized floats" do
      binary = <<0::signed-16-little, 16_384::signed-16-little, -16_384::signed-16-little>>
      decoded = WavEncoder.decode_int16(binary)

      assert length(decoded) == 3
      assert Enum.at(decoded, 0) == 0.0
      assert_in_delta Enum.at(decoded, 1), 0.5, 0.01
      assert_in_delta Enum.at(decoded, 2), -0.5, 0.01
    end
  end
end
