declare module 'node:crypto' {
  interface Sha256Hash {
    update(data: Uint8Array): this
    digest(encoding: 'hex'): string
  }

  export function createHash(algorithm: 'sha256'): Sha256Hash
}
