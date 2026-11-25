import math
import time

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.sin(d_lon / 2) ** 2 * math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

nodes = [
    {"id": "edge-mumbai", "name": "Edge Mumbai", "lat": 19.0760, "lng": 72.8777},
    {"id": "edge-delhi", "name": "Edge Delhi", "lat": 28.6139, "lng": 77.2090},
    {"id": "edge-singapore", "name": "Edge Singapore", "lat": 1.3521, "lng": 103.8198},
    {"id": "edge-london", "name": "Edge London", "lat": 51.5074, "lng": -0.1278},
    {"id": "edge-frankfurt", "name": "Edge Frankfurt", "lat": 50.1109, "lng": 8.6821},
    {"id": "edge-newyork", "name": "Edge New York", "lat": 40.7128, "lng": -74.0060},
    {"id": "edge-tokyo", "name": "Edge Tokyo", "lat": 35.6762, "lng": 139.6503},
    {"id": "edge-sydney", "name": "Edge Sydney", "lat": -33.8688, "lng": 151.2093}
]

client_mumbai = (19.0760, 72.8777)

def evaluate_route(client_lat, client_lng, loads):
    candidates = []
    for n in nodes:
        d = haversine(client_lat, client_lng, n["lat"], n["lng"])
        load = loads.get(n["id"], 15)
        score = round(d * 0.7 + load * 30, 2)
        candidates.append({"id": n["id"], "name": n["name"], "distanceKm": d, "load": load, "score": score})
    candidates.sort(key=lambda x: x["score"])
    return candidates[0]

# Throughput and latency measurement over 10,000 routing calculations
TOTAL_REQUESTS = 10000

# 1. Warm-up
evaluate_route(client_mumbai[0], client_mumbai[1], {n["id"]: 15 for n in nodes})

# 2. Simulate 10,000 requests during a viral traffic surge on Mumbai
start_time = time.perf_counter()
diverted_to_delhi = 0
routed_to_mumbai = 0

for i in range(TOTAL_REQUESTS):
    # As requests pour in, Mumbai's load spikes from 20% to 95%
    mumbai_load = min(95.0, 20.0 + (i / TOTAL_REQUESTS) * 75.0)
    loads = {n["id"]: 15 for n in nodes}
    loads["edge-mumbai"] = mumbai_load

    winner = evaluate_route(client_mumbai[0], client_mumbai[1], loads)
    if winner["id"] == "edge-delhi":
        diverted_to_delhi += 1
    elif winner["id"] == "edge-mumbai":
        routed_to_mumbai += 1

elapsed_sec = time.perf_counter() - start_time
rps = TOTAL_REQUESTS / elapsed_sec
latency_us = (elapsed_sec / TOTAL_REQUESTS) * 1_000_000
latency_ms = (elapsed_sec / TOTAL_REQUESTS) * 1000

print(f"BENCHMARK COMPLETED: {TOTAL_REQUESTS} requests evaluated")
print(f"Total Computation Time: {elapsed_sec*1000:.2f} ms")
print(f"Average Decision Latency: {latency_ms:.4f} ms ({latency_us:.2f} microseconds)")
print(f"Algorithm Decision Throughput: {rps:,.0f} routing decisions/sec")
print(f"Traffic Shedding: {diverted_to_delhi} requests ({diverted_to_delhi/TOTAL_REQUESTS*100:.1f}%) diverted from overloaded Mumbai to healthy Delhi")

