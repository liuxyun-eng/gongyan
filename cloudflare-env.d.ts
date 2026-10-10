declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AUTH_MODE?: string;
    AUTH_PEPPER?: string;
    REGISTRATION_CODE?: string;
    OPEN_REGISTRATION?: string;
  }
}
