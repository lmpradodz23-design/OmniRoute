/**
 * Buzz Bridge — assinatura/verificação de eventos Nostr (NIP-01), pura.
 *
 * Usa @noble/curves (schnorr secp256k1) + @noble/hashes (sha256). O id do evento é o
 * sha256 da serialização canônica [0,pubkey,created_at,kind,tags,content]; a assinatura é
 * schnorr sobre esse hash. Base para o WebSocketBuzzAdapter falar com o buzz-relay.
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export interface UnsignedNostrEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface SignedNostrEvent extends UnsignedNostrEvent {
  id: string;
  sig: string;
}

/** Gera uma secret key Nostr (32 bytes) em hex. */
export function generateSecretKey(): string {
  return bytesToHex(schnorr.utils.randomSecretKey());
}

/** Deriva a pubkey (x-only, 32 bytes) em hex a partir da secret key hex. */
export function getPublicKey(secretKeyHex: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(secretKeyHex)));
}

function serialize(e: UnsignedNostrEvent): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content])
  );
}

/** Calcula id + assina, produzindo um evento Nostr completo. */
export function finalizeEvent(
  unsigned: Omit<UnsignedNostrEvent, "pubkey">,
  secretKeyHex: string
): SignedNostrEvent {
  const sk = hexToBytes(secretKeyHex);
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const base: UnsignedNostrEvent = { ...unsigned, pubkey };
  const idBytes = sha256(serialize(base));
  const id = bytesToHex(idBytes);
  const sig = bytesToHex(schnorr.sign(idBytes, sk));
  return { ...base, id, sig };
}

/** Verifica id + assinatura schnorr de um evento. Fail-closed em qualquer erro. */
export function verifyEvent(e: SignedNostrEvent): boolean {
  try {
    const idBytes = sha256(serialize(e));
    if (bytesToHex(idBytes) !== e.id) return false;
    return schnorr.verify(hexToBytes(e.sig), idBytes, hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}
