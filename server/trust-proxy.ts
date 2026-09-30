/**
 * Which proxy hops Express trusts when resolving req.ip (KAN-307).
 *
 * Public traffic reaches express-frontend through the Google external
 * Application Load Balancer. The ALB appends "<client-ip>, <lb-ip>" to
 * X-Forwarded-For, and Cloud Run's front end is the socket peer, so the chain
 * Express walks (right to left) is: front end (hop 0), the LB's own frontend
 * address (hop 1), then the client.
 *
 * With `trust proxy 1`, req.ip was the LB address for every request: every
 * express-rate-limit limiter keyed on it became one bucket shared by all
 * visitors, and the RUM intake proxy geolocated every session to the LB.
 *
 * A plain hop count of 2 is not safe here: ingress
 * `internal-and-cloud-load-balancing` also admits direct internal callers
 * (same-project VPC resources, eligible Google services). Their chain is one
 * hop shorter, so a count of 2 would hand a caller-supplied X-Forwarded-For
 * value back as req.ip. So hop 1 is trusted only when it IS the load balancer:
 * a direct internal caller resolves to its own address, never to a value it
 * wrote into the header.
 */
import type { Express } from 'express';

/** The ALB frontend address (reserved address `vegangenius-ip`). */
export const DEFAULT_LB_IP = '34.8.251.224';

/**
 * Build the `trust proxy` function: trust the socket peer (Cloud Run's front
 * end, hop 0), and hop 1 only when it is the load balancer.
 */
export function trustProxyFor(lbIp: string): (addr: string, hop: number) => boolean {
  return (addr, hop) => hop === 0 || (hop === 1 && addr === lbIp);
}

/** Apply the policy; `TRUST_PROXY_LB_IP` overrides the LB address. */
export function applyTrustProxy(
  app: Express,
  lbIp = process.env.TRUST_PROXY_LB_IP || DEFAULT_LB_IP
): void {
  app.set('trust proxy', trustProxyFor(lbIp));
}
