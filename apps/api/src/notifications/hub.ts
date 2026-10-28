import pg from 'pg';

/** The Postgres channel that carries "this person has a new notification". */
export const NOTIFY_CHANNEL = 'forge_notifications';

type Listener = (notificationId: string) => void;

/**
 * Delivers new notifications to the open live streams of their recipient. Writers announce a
 * notification with `pg_notify` inside their own transaction, so Postgres sends it only if the
 * change commits, and to every API process listening. This process listens on one dedicated
 * connection, opened when the first person connects and re-opened if it drops.
 */
export class NotificationHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private retry: NodeJS.Timeout | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly log: (message: string, error?: unknown) => void,
  ) {}

  /** Starts listening for this person's notifications. Returns the function that stops it. */
  subscribe(userId: string, listener: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    void this.ensureListening();
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  /** How many streams this person has open. */
  streamsOf(userId: string): number {
    return this.listeners.get(userId)?.size ?? 0;
  }

  /** How many live streams are open, for tests and health. */
  get openStreams(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** Called with each payload, `<userId>:<notificationId>`; also used directly by tests. */
  deliver(payload: string): void {
    const [userId, notificationId] = payload.split(':');
    if (!userId || !notificationId) return;
    for (const listener of this.listeners.get(userId) ?? []) listener(notificationId);
  }

  /** Resolves once this process is listening (it may already be). */
  ensureListening(): Promise<void> {
    if (this.client || this.closed) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    client.on('notification', (message) => {
      if (message.channel === NOTIFY_CHANNEL && message.payload) this.deliver(message.payload);
    });
    client.on('error', (error) => {
      this.log('notification listener lost its connection', error);
      this.client = null;
      client.end().catch(() => {});
      this.scheduleRetry();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      if (this.closed) {
        await client.end();
        return;
      }
      this.client = client;
    } catch (error) {
      this.log('notification listener could not connect', error);
      client.end().catch(() => {});
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.closed || this.retry || this.listeners.size === 0) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.ensureListening();
    }, 5000);
    this.retry.unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    await this.connecting?.catch(() => {});
    await this.client?.end().catch(() => {});
    this.client = null;
    this.listeners.clear();
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Live notification delivery, so jobs and tests can reach it. */
    notificationHub: NotificationHub;
  }
}
