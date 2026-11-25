# EdgeMesh CDN Simulator — Interview Answers

## 1. Architecture & Request Flow

**Q: Explain the complete architecture of EdgeMesh.**
A: EdgeMesh is a distributed, multi-region Content Delivery Network (CDN) simulator designed using a microservices architecture. It simulates how global static file distribution works. The architecture is composed of five core microservices: an API Gateway, a Routing Engine, a Service Registry, distributed Edge Nodes (representing regional data centers like Mumbai, Delhi, Singapore), and an Origin Server. It also features a real-time admin dashboard powered by Socket.IO for observability. The system employs dynamic geo-routing to direct clients to the optimal edge node and uses a 3-tier waterfall caching pipeline to serve content rapidly.

**Q: Walk me through what happens when a client sends a request, from entry to response.**
A: 
1. The client sends an HTTP GET request (e.g., `/cdn/fetch?fileId=abc&lat=x&lng=y`) to the **API Gateway**.
2. The Gateway generates a unique `X-Request-ID` for distributed tracing and queries the **Routing Engine** (`/api/route`), passing the client's coordinates.
3. The Routing Engine fetches a list of `HEALTHY` nodes from the **Service Registry**. It calculates the physical distance to each node using the Haversine formula and computes a composite score (70% distance, 30% node load).
4. The Routing Engine returns the winning Edge Node configuration to the Gateway.
5. The API Gateway then proxies the request to the selected Edge Node.
6. The Edge Node attempts to fetch the file through a 3-tier cache:
   - **L1 (Redis)**: Checks in-memory cache. If hit, it returns immediately.
   - **L2 (Disk)**: If L1 misses, it checks the local SSD. If hit, it back-fills L1 and returns.
   - **L3 (Origin)**: If L2 misses, it fetches from the **Origin Server**, saves to L2, saves to L1, and returns the file buffer back to the Gateway.
7. The Gateway streams the response to the client, attaching headers like `X-Cache` and `X-Distance-Km`.

**Q: Why did you choose a microservices architecture instead of a monolith?**
A: A CDN naturally aligns with a distributed architecture. An Edge Node in Singapore physically cannot share the same monolithic runtime as the Origin server in the US or the Registry. Microservices allow us to independently scale, deploy, and geographically isolate components. It also provides fault isolation—if the Routing Engine crashes, the Origin can still theoretically function.

**Q: What are the five microservices, and what responsibility does each have?**
A: 
1. **API Gateway**: Single point of ingress, handles reverse proxying, generates trace IDs, and hides internal topology.
2. **Routing Engine**: Handles intelligent request placement by calculating Haversine distances and evaluating node load.
3. **Service Registry**: Manages service discovery, tracks node heartbeats, and automatically prunes unhealthy nodes (TTL Reaper).
4. **Edge Nodes**: Regional caching servers responsible for the L1/L2 cache pipeline and serving files to users.
5. **Origin Server**: The authoritative master storage for all files and metadata.

**Q: Why do you need an API Gateway?**
A: The Gateway serves as a unified entry point. It hides the complexity of our dynamic IP/port routing from the client frontend. It prevents CORS issues by handling cross-origin requests server-side. Most importantly, it initializes the distributed tracing sequence by stamping the initial `X-Request-ID` before fanning out.

**Q: What is the difference between your API Gateway and reverse proxy?**
A: While a traditional reverse proxy (like basic NGINX) simply forwards packets based on static rules, our API Gateway acts as an active orchestration layer. It makes an internal network call to the Routing Engine to actively discover *where* to proxy the request on a per-request basis, making it a dynamic, logic-heavy gateway rather than a dumb proxy.

**Q: How do the microservices communicate with each other?**
A: They primarily communicate via synchronous REST APIs over HTTP (using `axios`). For example, the Gateway makes an HTTP POST to the Routing Engine. However, for real-time observability, the Service Registry uses WebSockets (Socket.IO) to stream logs and state changes asynchronously to the UI.

**Q: What happens if one microservice becomes unavailable?**
A: Our system is built with fault tolerance. If an Edge Node goes down, it stops sending heartbeats. The Registry's TTL Reaper detects this after 10 seconds and marks it `UNHEALTHY`. The Routing Engine will then seamlessly exclude it from future routing calculations. If Redis goes down on an edge node, we have an internal `MockRedis` in-memory fallback. However, the API Gateway and Service Registry are currently single points of failure.

**Q: What are the single points of failure in your architecture?**
A: In this simulated design, the API Gateway, Routing Engine, Service Registry, and Origin Server are single points of failure. If the Gateway goes down, no client traffic can enter the network.

**Q: If I give you 10x the traffic, what becomes the first bottleneck?**
A: The API Gateway would bottleneck first because 100% of the traffic flows through it for ingress and proxying. In a real-world CDN, you don't route traffic through a centralized Gateway; you use DNS Anycast to route clients directly to the nearest Edge Node's IP at the network layer.

---

## 2. Geo-routing

**Q: Why did you use the Haversine formula?**
A: The Haversine formula calculates the great-circle distance between two points on a sphere. Since the Earth is spherical, this is required to get accurate physical distances between a user's GPS coordinates and our data centers.

**Q: Explain how Haversine calculates the distance between two locations.**
A: It uses spherical trigonometry. Given the latitude and longitude of two points, it converts them to radians, calculates the differences, and applies the sine and cosine functions to find the angular distance. We then multiply this angular distance by the Earth's radius (approx 6,371 km) to get the physical distance in kilometers.

**Q: Why can't you simply use Euclidean distance for latitude/longitude?**
A: Euclidean distance assumes a flat 2D Cartesian plane. Because longitude lines converge at the poles and spread out at the equator, a degree of longitude represents a different physical distance depending on the latitude. Euclidean math would yield severely distorted and inaccurate distance measurements, especially over long global distances.

**Q: Show me the code that performs geo-routing.**
A: In `apps/routing-engine/src/index.ts`, we iterate through the `healthyNodes` array and apply our scoring logic:
```typescript
const distanceKm = calculateHaversineDistance(clientLat, clientLng, config.lat, config.lng);
const loadPct = heartbeat.loadPercentage || 0;
// Composite scoring formula: 70% Distance + 30% Load
const score = distanceKm * 0.7 + loadPct * 30;
```
We then sort the candidate nodes by this `score` in ascending order and select `candidateScores[0]` as the winner.

**Q: How do you choose the region to which a request should be routed?**
A: We calculate a composite score that is weighted 70% toward geographic distance and 30% toward the real-time CPU load of the node. The region with the lowest combined score wins the request.

**Q: What does load-aware routing mean in your implementation?**
A: It means we don't just blindly send traffic to the closest geographic server. Each edge node sends its CPU load percentage to the Registry in a 3-second heartbeat. The Routing Engine incorporates this metric so that if a node is heavily congested, its score inflates, effectively penalizing it.

**Q: What happens if the geographically closest region is overloaded?**
A: Because load accounts for 30% of the score, a massive spike in CPU load will inflate the node's score. This allows a slightly further, but much healthier, Edge Node to achieve a lower overall score and win the routing bid. This prevents "hot-spotting" and cascading failures.

**Q: Is geographical distance always a good indicator of network latency?**
A: No. Geographic distance ignores the actual topology of the internet. A node might be geographically close, but the network packets might take a highly inefficient route due to ISP peering agreements, underwater cable cuts, or BGP routing policies.

**Q: How would you improve your routing algorithm for a production system?**
A: I would replace application-layer Haversine routing with network-layer BGP Anycast, allowing routers to resolve the shortest network path automatically. Alternatively, I would implement active latency probing (having edge nodes continuously ping client subnets) to route based on true network latency (RTT) rather than physical distance.

**Q: What happens if the selected region suddenly goes down?**
A: If it goes down after routing but before the request completes, the Gateway request will time out or fail. However, within 10 seconds, the node will miss its heartbeats to the Registry, the TTL Reaper will mark it `UNHEALTHY`, and subsequent routing requests will no longer consider it as a candidate.

---

## 3. Caching

**Q: Explain your 3-tier caching architecture.**
A: We use a waterfall approach to balance speed and cost:
- **L1 Cache (Redis)**: In-memory, incredibly fast (<15ms), but volatile and memory-constrained. Stores base64 encoded files with a 5-minute TTL.
- **L2 Cache (Disk)**: Local SSD storage on the Edge Node. Slower than RAM (<45ms) but allows for much larger, persistent caching.
- **L3 Cache (Origin)**: The master source of truth. Slowest (100-300ms) but guaranteed to have the requested file.

**Q: Why did you choose Redis + Disk + Origin?**
A: It optimizes the cost-to-performance ratio. RAM (Redis) is expensive, so we only store the most frequently accessed, "hot" objects there. SSDs (Disk) are cheaper, allowing us to cache a massive "warm" catalog locally without evicting constantly. The Origin handles the "cold" long-tail content.

**Q: Walk me through a cache hit.**
A: The Gateway proxies a request to an Edge Node. The node checks its local Redis instance (`file:[fileId]`). The data is found, decoded, and returned to the client in under 15ms. L2 and L3 are never touched.

**Q: Walk me through a cache miss.**
A: The node checks Redis (Miss). It then checks the local L2 Disk (Miss). It must now perform a network fetch to the L3 Origin server. Once the Origin returns the file, the Edge Node saves it to the L2 Disk, caches it in L1 Redis, and finally returns it to the client.

**Q: What happens when Redis misses but disk has the object?**
A: The node reads the file from the local SSD and serves it to the client. Simultaneously, it triggers an asynchronous back-fill operation to write that file back into the L1 Redis cache.

**Q: After finding an object on disk, do you populate Redis again? Why?**
A: Yes. If a file was requested, it has demonstrated recent activity. By promoting it back into the L1 cache, we ensure that the next client requesting that same file will get the sub-15ms Redis response rather than hitting the disk again.

**Q: How do you decide the TTL of a cached object?**
A: In EdgeMesh, L1 Redis cache uses a static TTL of 300 seconds (5 minutes). In a real CDN, TTL is often dictated by the `Cache-Control: max-age` HTTP headers sent by the Origin server or configured by the customer based on how frequently their content changes.

**Q: How do you handle cache invalidation?**
A: Currently, we rely on passive TTL expiration. Once the 300-second window passes, Redis evicts the key, forcing a fresh fetch on the next request.

**Q: What happens if the origin changes but an old version exists in the cache?**
A: We will serve stale data to the client until the 5-minute TTL expires. To fix this in production, we would need to implement active cache invalidation (a PURGE API endpoint) that the Origin can call when a file is modified, instructing all Edge Nodes to instantly drop the key.

**Q: Explain cache stampede and how you would prevent it in EdgeMesh.**
A: A cache stampede occurs when a highly popular key expires (or is purged). Suddenly, thousands of concurrent requests miss the cache and hit the Origin server at the exact same millisecond, potentially crashing it. To prevent this, I would implement "Request Collapsing" (or Promise sharing) at the Edge Node: if a fetch is already in flight for `fileId=abc`, subsequent requests for `abc` wait on the pending promise rather than initiating new network requests to the Origin.

---

## 4. Redis

**Q: Why Redis instead of MongoDB for caching?**
A: Redis is an in-memory data structure store, whereas MongoDB is a disk-oriented document database. For an L1 cache, we require sub-millisecond read latencies that only RAM can provide. MongoDB introduces disk I/O and query parsing overhead that is unnecessary for simple key-value lookups.

**Q: What Redis data structures are you using and why?**
A: We are using simple Strings (Key-Value). We store the file contents as base64-encoded strings under keys formatted like `file:[fileId]`. Strings are perfectly suited for caching whole file buffers.

**Q: What happens when Redis runs out of memory?**
A: Redis will start rejecting new writes unless an eviction policy is configured. 

**Q: What Redis eviction policy would you use for a CDN?**
A: `allkeys-lru` (Least Recently Used). This ensures that when memory is full, the CDN automatically evicts the files that haven't been requested in a long time, making room for newly requested "hot" files.

**Q: What happens if your Redis instance goes down?**
A: Our Edge Node architecture includes fault-tolerant fallbacks using `ioredis`. If the actual Redis server is unavailable, the application gracefully degrades to using an internal `MockRedis` in-memory Map structure so the edge node can survive the outage.

**Q: How would you make Redis highly available?**
A: I would deploy Redis Sentinel to monitor a primary-replica setup. If the primary Redis node fails, Sentinel automatically promotes a replica to primary, ensuring no downtime for the L1 cache.

**Q: Redis Replication vs Redis Cluster — which would you choose and why?**
A: For a single Edge Node's local cache, Replication (with Sentinel) is preferred because it's simpler and provides high availability. However, if the L1 cache needed to hold terabytes of data that exceeds the RAM of a single physical machine, I would choose Redis Cluster to automatically shard the keyspace across multiple servers.

---

## 5. Performance / Reliability

**Q: You claim 85% latency reduction — exactly how did you measure it?**
A: We benchmark the "Total Latency" metric, which is the delta between the Gateway receiving the request and returning the response. We compare the baseline latency of an L3 Origin fetch against the latency of an L1 Redis Cache hit.

**Q: What was the baseline latency, and what was the final latency?**
A: A full network round-trip to the L3 Origin typically takes 100-300ms. An L1 Redis cache hit processes in <15ms. 15ms is roughly a 90% to 85% reduction compared to 100-150ms.

**Q: Did you measure cold-cache and warm-cache latency separately?**
A: Yes. A cold-cache latency (Miss) includes the overhead of checking L1, checking L2, and fetching from L3. A warm-cache latency (Hit) completely bypasses network and disk I/O, validating the efficiency of the architecture.

**Q: What is P95 vs P99 latency, and which is more useful here?**
A: P95 means 95% of requests complete faster than a given time; P99 means 99%. In a CDN, P99 is highly useful because it highlights "tail latencies" (e.g., severe network jitter, garbage collection pauses, or cold disk spin-ups) that affect the worst-case user experience.

**Q: How did you perform load testing?**
A: While automated load-testing scripts aren't in the core repository, standard procedure involves using tools like `k6` or `Artillery` to bombard the API Gateway with thousands of concurrent requests, measuring how the CPU Load metric triggers load-aware routing transitions in real-time.

**Q: Explain your failover mechanism.**
A: Failover is handled actively by the Service Registry. Every node emits a heartbeat every 3000ms. The Registry runs a TTL Reaper. If a node crashes, the heartbeats stop. After 10 seconds of silence, the node is marked `UNHEALTHY` and the Routing Engine instantly routes traffic to the next best node.

**Q: How do you detect that a region has failed?**
A: By the absence of its automated heartbeats to the central Service Registry.

**Q: Why are timeouts and retries important in distributed systems?**
A: In a microservices architecture, network calls can hang indefinitely due to dropped packets or overwhelmed services. Timeouts prevent a thread-pool exhaustion on the calling service (e.g., the Gateway). Retries ensure that transient network blips don't result in failed user requests.

**Q: Why can retries actually make an outage worse?**
A: If a service (like the Origin) is overwhelmed and struggling to keep up, sending automatic retries creates a "Retry Storm" or "Thundering Herd." You are actively multiplying the load on an already failing system, ensuring it crashes completely.

**Q: What is exponential backoff with jitter?**
A: To solve the retry storm problem, subsequent retries are delayed exponentially (e.g., wait 1s, then 2s, then 4s). "Jitter" adds a random millisecond variance to this delay. Without jitter, all clients that failed at the same time will retry at the exact same time 1 second later, re-overwhelming the server. Jitter spreads the retries out.

**Q: What exactly does tracing mean in your project?**
A: Tracing is the ability to track a single user's request as it traverses multiple independent microservices. We achieve this by generating a unique `X-Request-ID` at the API Gateway and passing it downstream in the HTTP headers to the Routing Engine, Edge Node, and logging streams.

**Q: How would you trace one request across all five microservices?**
A: We log the `X-Request-ID` in the Pino structured logs at every service boundary. We also emit `StepLogEvent` payloads containing this ID back to the Registry. By filtering for a specific ID in the Admin Dashboard or a centralized logging tool (like Elasticsearch or Datadog), we can reconstruct the exact timeline of the request across all five services.

**Q: If you had to rebuild EdgeMesh for production at 100x the traffic, what would you change?**
A: 
1. **Remove API Gateway Bottleneck**: Use DNS Anycast to route clients directly to regional edge IPs at the network layer.
2. **Scale Origin**: Move the master storage from a single Node.js server to an S3-compatible object store.
3. **Consistent Hashing**: Instead of simple Haversine routing, I'd implement Consistent Hashing on the edge to ensure the same files always hit the same specific edge servers, maximizing cache hit ratios.
4. **Cache Stampede Protection**: Implement request collapsing at the edge.
5. **Active Invalidation**: Build a Pub/Sub system to broadcast instant cache purges to all edge nodes.
