defmodule TimbreWeb.Router do
  use TimbreWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  # Ops probes — unauthenticated, no `:accepts` plug so bare LB/k8s probes work.
  scope "/", TimbreWeb do
    get "/healthz", HealthController, :live
    get "/readyz", HealthController, :ready
  end

  scope "/api", TimbreWeb do
    pipe_through :api

    get "/hello", HelloController, :show

    get "/recordings", RecordingsController, :index
    post "/recordings", RecordingsController, :create
    get "/recordings/:id/audio", RecordingsController, :audio
    delete "/recordings/:id", RecordingsController, :delete

    # Bonus: AI Transcription & Summarization
    post "/recordings/:id/transcribe", TranscriptionController, :create
    get "/recordings/:id/transcript", TranscriptionController, :show
  end
end
