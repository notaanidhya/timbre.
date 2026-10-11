import { Socket, Channel } from 'phoenix'

export interface ParticipantInfo {
  name: string
  chunks_count: number
  done: boolean
  start_ts: number
}

export interface SessionStatePayload {
  session_id: string
  participants: ParticipantInfo[]
}

export interface PeerLevelPayload {
  participant: string
  level: number
}

export interface MergeCompletePayload {
  recording_id: number
  title: string
  duration_ms: number
}

export class PhoenixSessionManager {
  private socket: Socket | null = null
  private channel: Channel | null = null
  private seqCounter = 0

  constructor(
    private sessionEndpoint: string = '/socket',
    private onStateChange?: (connected: boolean) => void
  ) {}

  public connect(participantName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socketUrl =
        import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}${this.sessionEndpoint}`

      this.socket = new Socket(socketUrl, {
        params: { participant: participantName },
      })

      this.socket.onOpen(() => {
        this.onStateChange?.(true)
        resolve()
      })

      this.socket.onError(() => {
        this.onStateChange?.(false)
        reject(new Error('WebSocket connection failed'))
      })

      this.socket.onClose(() => {
        this.onStateChange?.(false)
      })

      this.socket.connect()
    })
  }

  public joinRoom(
    roomId: string,
    callbacks: {
      onParticipantJoined?: (participant: string) => void
      onParticipantDone?: (participant: string) => void
      onPeerLevel?: (payload: PeerLevelPayload) => void
      onSessionState?: (state: SessionStatePayload) => void
      onMergeComplete?: (payload: MergeCompletePayload) => void
      onMergeError?: (reason: string) => void
    }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Socket not connected'))

      this.channel = this.socket.channel(`session:${roomId}`, {})
      this.seqCounter = 0

      this.channel.on('participant_joined', (msg: { participant: string }) => {
        callbacks.onParticipantJoined?.(msg.participant)
      })

      this.channel.on('participant_done', (msg: { participant: string }) => {
        callbacks.onParticipantDone?.(msg.participant)
      })

      this.channel.on('peer_level', (msg: PeerLevelPayload) => {
        callbacks.onPeerLevel?.(msg)
      })

      this.channel.on('session_state', (msg: SessionStatePayload) => {
        callbacks.onSessionState?.(msg)
      })

      this.channel.on('merge_complete', (msg: MergeCompletePayload) => {
        callbacks.onMergeComplete?.(msg)
      })

      this.channel.on('merge_error', (msg: { reason: string }) => {
        callbacks.onMergeError?.(msg.reason)
      })

      this.channel
        .join()
        .receive('ok', () => resolve())
        .receive('error', (resp) => reject(new Error(resp.reason || 'Failed to join channel')))
    })
  }

  public sendFirstChunk(startTs: number, buffer: ArrayBuffer, track?: string): void {
    if (!this.channel) return
    this.seqCounter++
    const b64 = this.arrayBufferToBase64(buffer)
    this.channel.push('first_chunk', {
      start_ts: startTs,
      seq: this.seqCounter,
      chunk: b64,
      track,
    })
  }

  public sendAudioChunk(buffer: ArrayBuffer, track?: string): void {
    if (!this.channel) return
    this.seqCounter++
    const b64 = this.arrayBufferToBase64(buffer)
    this.channel.push('audio_chunk', {
      seq: this.seqCounter,
      chunk: b64,
      track,
    })
  }

  public sendLevel(level: number, track?: string): void {
    if (!this.channel) return
    this.channel.push('level', { level, track })
  }

  public sendParticipantDone(track?: string): void {
    if (!this.channel) return
    this.channel.push('participant_done', { track })
  }

  public addTake(track: string): void {
    if (!this.channel) return
    this.channel.push('add_take', { track })
  }

  public resetTake(track: string): void {
    if (!this.channel) return
    this.channel.push('reset_take', { track })
  }

  public triggerMerge(): Promise<{ recording_id: number }> {
    return new Promise((resolve, reject) => {
      if (!this.channel) return reject(new Error('Channel not active'))

      this.channel
        .push('merge_now', {}, 45000)
        .receive('ok', (resp: { recording_id: number }) => resolve(resp))
        .receive('error', (err: { reason: string }) => reject(new Error(err.reason || 'Merge failed')))
        .receive('timeout', () => reject(new Error('Merge request timed out')))
    })
  }

  public leave(): void {
    if (this.channel) {
      this.channel.leave()
      this.channel = null
    }
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.onStateChange?.(false)
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }
}
