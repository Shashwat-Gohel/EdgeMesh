# EdgeMesh CDN Simulator — Live Demonstration Script

Use this step-by-step guide to showcase the key features of the EdgeMesh architecture to your interviewers. It directly aligns with the answers you provided in your interview prep.

## Phase 1: Launch and System Overview

**1. Start the System**
* **Action:** Open your terminal in the `edgeroute` folder and run `.\start-servers.bat`.
* **Talking Point:** *"To start, I'm launching the entire microservices cluster using a batch script. This brings up the API Gateway, Routing Engine, Service Registry, the Origin Server, and our 3 regional Edge Nodes (Mumbai, Delhi, Singapore) along with their Redis instances."*

**2. Introduce the Admin Dashboard**
* **Action:** Open your browser to the Admin Dashboard at `http://localhost:5173`.
* **Talking Point:** *"This is the real-time observability dashboard powered by Socket.IO. As you can see, the Edge Nodes have automatically registered with the Service Registry. You can see their live heartbeats coming in every 3 seconds, reporting their CPU load and storage metrics. This demonstrates our **Service Discovery and Health Monitoring**."*

## Phase 2: Demonstrating the 3-Tier Caching Pipeline

**3. The First Request (Cold Cache / L3 Miss)**
* **Action:** Open a new browser tab for the Client Simulator at `http://localhost:5174`. Select a starting location (e.g., India South / close to Mumbai). Click "Fetch File".
* **Talking Point:** *"I'm going to simulate a user requesting a static file. When I hit fetch, the API Gateway queries the Routing Engine, which uses the Haversine formula to route us to the nearest healthy node (Mumbai). Because this file has never been requested before, it's a **Cache Miss**."*
* **Action:** Switch back to the Admin Dashboard and point to the live logs.
* **Talking Point:** *"Looking at the distributed tracing logs, you can see the waterfall in action: it missed L1 (Redis), missed L2 (Disk), and had to perform an L3 fetch from the Origin Server on port 5000. It then saved the file to L2 and L1 before returning it to the user. Notice the total latency is high (e.g., 150ms+)."*

**4. The Second Request (Warm Cache / L1 Hit)**
* **Action:** Go back to the Client Simulator (`http://localhost:5174`) and hit "Fetch File" again for the same file.
* **Talking Point:** *"Now, if a second user requests the same file, or the same user reloads, watch the latency."*
* **Action:** Show the drastically reduced latency on the client screen, then switch to the Admin Dashboard logs.
* **Talking Point:** *"The response was near-instant (<15ms). The logs show an **L1 Redis Cache Hit**. We completely bypassed the disk and the network hop to the Origin Server. This is how the system achieves an 85%+ reduction in latency."*

## Phase 3: Demonstrating Geo-Routing and Load Balancing

**5. Changing Geographic Location**
* **Action:** In the Client Simulator (`http://localhost:5174`), change the simulated user location to "Southeast Asia" (closer to Singapore). Click "Fetch File".
* **Talking Point:** *"To demonstrate the Haversine formula routing, I've moved the user's GPS coordinates to Southeast Asia. When I request the file, the Gateway queries the Routing Engine. The Haversine math calculates that the Singapore Edge Node is physically closer than Mumbai or Delhi."*
* **Action:** Point to the response headers in the Client UI or the logs in the Admin Dashboard.
* **Talking Point:** *"As you can see, the `X-Selected-Node-Name` header shows the request was dynamically routed to Singapore. It's a cache miss on Singapore because Singapore hasn't cached this file yet, proving the nodes operate independently."*

## Phase 4: Demonstrating Fault Tolerance and Failover

**6. Simulating a Node Failure**
* **Action:** Open the terminal window where the **Mumbai Edge Node (Port 4001)** is running and kill the process (`Ctrl+C`).
* **Talking Point:** *"In a distributed system, servers fail. I've just simulated a catastrophic crash of the Mumbai data center."*
* **Action:** Immediately switch to the Admin Dashboard (`http://localhost:5173`).
* **Talking Point:** *"Watch the Service Registry. The Mumbai node has stopped sending its 3-second heartbeats. After 10 seconds of silence, the TTL Reaper kicks in..."* (Wait for the UI to show the node turning red/UNHEALTHY). *"There. The Registry has marked Mumbai as UNHEALTHY."*

**7. Routing Around the Failure**
* **Action:** Go to the Client Simulator (`http://localhost:5174`), set the location back to India South (which normally routes to Mumbai), and click "Fetch File".
* **Talking Point:** *"Now, a user in Mumbai requests a file. The Routing Engine sees that Mumbai is UNHEALTHY and excludes it from the candidate list. It calculates the next best option based on distance and load, and seamlessly routes the user to the Delhi node instead. The user experiences zero downtime."*

## Wrap-up

* **Talking Point:** *"This concludes the end-to-end demonstration. We've seen dynamic Service Discovery, Geo-location Haversine routing, a 3-tier caching mechanism using Redis and disk, distributed tracing via `X-Request-ID`, and automated fault-tolerance. I'm happy to dive into any specific part of the codebase you'd like to see!"*
