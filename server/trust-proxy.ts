/**
 * How many proxy hops Express trusts when resolving req.ip (KAN-307).
 *
 * Production traffic reaches express-frontend through the Google external
 * Application Load Balancer, and Cloud Run ingress is
 * `internal-and-cloud-load-balancing`, so every request arrives through it. The
 * ALB appends "<client-ip>, <lb-ip>" to X-Forwarded-For, so the LAST entry is
 * the load balancer's own frontend address (34.8.251.224) and the client is the
 * one before it.
 *
 * With 1 hop, req.ip was the LB address for every request: every express-rate-limit
 * limiter keyed on it became one bucket shared by all visitors, and the RUM
 * intake proxy geolocated every session to the LB. 2 hops resolves the client,
 * and anything a client puts in X-Forwarded-For itself sits further left and is
 * ignored.
 *
 * If ingress is ever opened to direct run.app traffic, this count is wrong in
 * the other direction (a spoofed header would win): change both together.
 */
export const TRUST_PROXY_HOPS = 2;
