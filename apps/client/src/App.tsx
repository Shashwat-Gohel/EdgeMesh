import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MapPin, Download, FileText, CheckCircle2, Clock, Zap, ArrowRight, RefreshCcw, Target } from 'lucide-react';
import { EdgeNodeConfig, FileMetadata } from '@edgemesh/shared-types';

const GATEWAY_URL = 'http://localhost:3000';
const ORIGIN_URL = 'http://localhost:5000';
const REGISTRY_URL = 'http://localhost:3002';

interface PresetLocation {
  name: string;
  lat: number;
  lng: number;
}

const PRESETS: PresetLocation[] = [
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'Frankfurt', lat: 50.1109, lng: 8.6821 },
  { name: 'New York', lat: 40.7128, lng: -74.0060 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
];

interface ExecutionStep {
  step: number;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'completed';
}

export default function App() {
  const [lat, setLat] = useState<string>('19.0760');
  const [lng, setLng] = useState<string>('72.8777');
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [downloadBlobUrl, setDownloadBlobUrl] = useState<string | null>(null);

  const [selectedEdgeFn, setSelectedEdgeFn] = useState<'none' | 'inject-security-headers' | 'geo-personalization'>('none');

  const [manualOverride, setManualOverride] = useState<boolean>(false);
  const [availableNodes, setAvailableNodes] = useState<EdgeNodeConfig[]>([]);
  const [preferredNodeId, setPreferredNodeId] = useState<string>('');

  const [metrics, setMetrics] = useState<{
    cacheStatus: string;
    selectedNodeId: string;
    selectedNodeName: string;
    distanceKm: string;
    totalLatencyMs: string;
    routingMode: string;
    lambdaFnExecuted?: string;
    lambdaGreeting?: string;
    lambdaHeadersCount?: number;
  } | null>(null);

  const [timeline, setTimeline] = useState<ExecutionStep[]>([
    { step: 1, label: 'Client Request Ingress', detail: 'Waiting to start...', status: 'pending' },
    { step: 2, label: 'API Gateway Forwarding', detail: 'Waiting to start...', status: 'pending' },
    { step: 3, label: 'Routing Engine Decision', detail: 'Waiting to start...', status: 'pending' },
    { step: 4, label: 'Edge Node Redis L1 Check', detail: 'Waiting to start...', status: 'pending' },
    { step: 5, label: 'Edge Node Disk L2 Check', detail: 'Waiting to start...', status: 'pending' },
    { step: 6, label: 'Origin L3 Fetch (If Miss)', detail: 'Waiting to start...', status: 'pending' },
    { step: 7, label: 'Egress Delivery to Client', detail: 'Waiting to start...', status: 'pending' },
  ]);

  useEffect(() => {
    fetchOriginFiles();
    fetchAvailableNodes();
  }, []);

  const fetchAvailableNodes = async () => {
    try {
      const res = await axios.get(`${REGISTRY_URL}/api/nodes/healthy`);
      const nodes: EdgeNodeConfig[] = (res.data.nodes || []).map((n: { config: EdgeNodeConfig }) => n.config);
      setAvailableNodes(nodes);
      if (nodes.length > 0 && !preferredNodeId) {
        setPreferredNodeId(nodes[0].id);
      }
    } catch {
      setAvailableNodes([]);
    }
  };

  const fetchOriginFiles = async () => {
    try {
      const res = await axios.get(`${ORIGIN_URL}/api/files`);
      const fileList: FileMetadata[] = res.data.files || [];
      setFiles(fileList);
      if (fileList.length > 0 && !selectedFileId) {
        setSelectedFileId(fileList[0].fileId);
      }
    } catch {
      // Fallback sample file ID if origin server is offline
      setFiles([{ fileId: 'sample-doc', originalName: 'demo-sample-file.txt', mimeType: 'text/plain', sizeBytes: 1024, checksum: '', createdAt: '' }]);
      setSelectedFileId('sample-doc');
    }
  };

  const handleFetch = async () => {
    if (!selectedFileId) return;
    if (manualOverride && !preferredNodeId) return;

    setLoading(true);
    setMetrics(null);
    setDownloadBlobUrl(null);

    const clientLat = parseFloat(lat) || 0;
    const clientLng = parseFloat(lng) || 0;

    // Reset timeline state
    setTimeline([
      {
        step: 1,
        label: 'Client Request Ingress',
        detail: manualOverride
          ? `Requesting file '${selectedFileId}' with manual override to node '${preferredNodeId}'`
          : `Requesting file '${selectedFileId}' from coords (${clientLat.toFixed(2)}, ${clientLng.toFixed(2)})`,
        status: 'running',
      },
      { step: 2, label: 'API Gateway Forwarding', detail: 'Gateway received request', status: 'pending' },
      {
        step: 3,
        label: 'Routing Engine Decision',
        detail: manualOverride ? `Skipping scoring — routing directly to '${preferredNodeId}'...` : 'Calculating Haversine distance across nodes...',
        status: 'pending',
      },
      { step: 4, label: 'Edge Node Redis L1 Check', detail: 'Checking fast in-memory Redis cache...', status: 'pending' },
      { step: 5, label: 'Edge Node Disk L2 Check', detail: 'Checking local node storage...', status: 'pending' },
      { step: 6, label: 'Origin L3 Fetch (If Miss)', detail: 'Fetching from master storage on miss...', status: 'pending' },
      { step: 7, label: 'Egress Delivery to Client', detail: 'Final response delivery...', status: 'pending' },
    ]);

    const startTime = Date.now();

    try {
      const response = await axios.get(`${GATEWAY_URL}/cdn/fetch`, {
        params: {
          fileId: selectedFileId,
          lat: clientLat,
          lng: clientLng,
          edgeFn: selectedEdgeFn,
          ...(manualOverride ? { node: preferredNodeId } : {}),
        },
        responseType: 'blob',
      });

      const cacheStatus = (response.headers['x-cache'] as string) || 'MISS-FETCHED-FROM-ORIGIN';
      const selectedNodeId = (response.headers['x-selected-node-id'] as string) || 'edge-mumbai';
      const selectedNodeName = (response.headers['x-selected-node-name'] as string) || 'Edge Mumbai';
      const distanceKm = (response.headers['x-distance-km'] as string) || '12.4';
      const totalLatencyMs = (response.headers['x-total-latency-ms'] as string) || (Date.now() - startTime).toString();
      const routingMode = (response.headers['x-routing-mode'] as string) || (manualOverride ? 'manual' : 'auto');
      const lambdaFnExecuted = response.headers['x-lambda-edge-executed'] as string | undefined;
      const lambdaGreeting = response.headers['x-lambda-edge-greeting'] as string | undefined;

      // Create downloadable file object URL
      const mimeTypeStr = typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : 'application/octet-stream';
      const blob = new Blob([response.data], { type: mimeTypeStr });
      const url = URL.createObjectURL(blob);
      setDownloadBlobUrl(url);

      setMetrics({
        cacheStatus,
        selectedNodeId,
        selectedNodeName,
        distanceKm,
        totalLatencyMs,
        routingMode,
        lambdaFnExecuted,
        lambdaGreeting,
      });

      // Update timeline to all completed
      setTimeline([
        { step: 1, label: 'Client Request Ingress', detail: `Sent request from coordinates (${clientLat.toFixed(4)}, ${clientLng.toFixed(4)})`, status: 'completed' },
        { step: 2, label: 'API Gateway Forwarding', detail: `Forwarded via Gateway (${GATEWAY_URL})`, status: 'completed' },
        {
          step: 3,
          label: 'Routing Engine Decision',
          detail:
            routingMode === 'manual'
              ? `🎯 Manual override → ${selectedNodeName} (scoring skipped, ${distanceKm} km)`
              : `Selected Node: ${selectedNodeName} (${distanceKm} km)`,
          status: 'completed',
        },
        { step: 4, label: 'Lambda@Edge Function', detail: lambdaFnExecuted ? `⚡ Executed '${lambdaFnExecuted}' at Edge` : 'Bypassed (No edge function selected)', status: 'completed' },
        { step: 5, label: 'Edge Node Cache Check', detail: cacheStatus.startsWith('HIT') ? `🎯 CACHE HIT (${cacheStatus})` : 'Cache MISS', status: 'completed' },
        { step: 6, label: 'Origin L3 Fetch (If Miss)', detail: cacheStatus.startsWith('MISS') ? '☁️ Fetched from Origin Master Storage' : 'Bypassed (Served from Edge)', status: 'completed' },
        { step: 7, label: 'Egress Delivery to Client', detail: `Completed in ${totalLatencyMs}ms. Status: ${cacheStatus}`, status: 'completed' },
      ]);
    } catch (err) {
      const axiosErr = err as import('axios').AxiosError<Blob>;
      // responseType is 'blob', so an error body also arrives as a Blob and must be re-parsed as JSON.
      let serverMessage: string | undefined;
      if (axiosErr.response?.data instanceof Blob) {
        try {
          const text = await axiosErr.response.data.text();
          serverMessage = JSON.parse(text)?.error;
        } catch {
          // Non-JSON error body; ignore and fall through to axiosErr.message
        }
      }
      const errorMessage = serverMessage || axiosErr.message;

      setTimeline((prev) =>
        prev.map((item) => ({ ...item, status: 'completed', detail: item.step === 7 ? `Error: ${errorMessage}` : item.detail }))
      );
      alert(
        manualOverride && serverMessage
          ? `Manual routing failed: ${errorMessage}`
          : 'Request failed: ' + errorMessage
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono border-t-2 border-white">
      {/* Minimal Header */}
      <header className="flex items-center justify-between pb-6 mb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase flex items-center gap-2">
            <Zap className="w-5 h-5 text-white" />
            EDGEMESH // CLIENT REQUEST SIMULATOR
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Simulate User Geolocation Requests & Trace CDN Routing</p>
        </div>
        <button
          onClick={fetchOriginFiles}
          className="p-1.5 bg-zinc-900 border border-zinc-700 hover:bg-white hover:text-black transition text-xs flex items-center gap-1"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> REFRESH FILES
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form & Coordinates */}
        <div className="space-y-6">
          {/* Location Picker */}
          <div className="bg-black border border-zinc-800 p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
              <MapPin className="w-4 h-4 text-white" />
              1. Select Client Geolocation
            </h2>

            {/* Presets */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {PRESETS.map((p) => {
                const isActive = parseFloat(lat) === p.lat && parseFloat(lng) === p.lng;
                return (
                  <button
                    key={p.name}
                    onClick={() => {
                      setLat(p.lat.toString());
                      setLng(p.lng.toString());
                    }}
                    className={`p-2 text-xs border uppercase font-mono transition ${
                      isActive
                        ? 'border-white bg-white text-black font-bold'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>

            {/* Custom Coordinates Input */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase mb-1">Latitude</label>
                <input
                  type="text"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-white font-mono focus:border-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase mb-1">Longitude</label>
                <input
                  type="text"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-white font-mono focus:border-white focus:outline-none"
                />
              </div>
            </div>

            {/* Manual Edge Node Override */}
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <button
                onClick={() => setManualOverride((v) => !v)}
                className={`w-full flex items-center justify-between p-2 border text-[10px] uppercase font-bold tracking-wider transition ${
                  manualOverride ? 'border-amber-400 bg-amber-950/30 text-amber-300' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Target className="w-3.5 h-3.5" />
                  Manual Node Override
                </span>
                <span>{manualOverride ? 'ON — Scoring Bypassed' : 'OFF'}</span>
              </button>

              {manualOverride && (
                <div className="mt-3">
                  <label className="block text-[10px] text-zinc-500 uppercase mb-1">
                    Force Request To Node
                  </label>
                  <select
                    value={preferredNodeId}
                    onChange={(e) => setPreferredNodeId(e.target.value)}
                    className="w-full bg-zinc-950 border border-amber-900/50 px-3 py-2 text-xs text-amber-300 font-mono focus:border-amber-400 focus:outline-none"
                  >
                    {availableNodes.length === 0 && <option value="">No healthy nodes registered</option>}
                    {availableNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.id}) — {n.region}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Your coordinates above are still sent with the request (for distance/latency measurement), but node selection is forced — the request is sent to this node only, skipping Haversine/load scoring.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* File Picker & Execute Button */}
          <div className="bg-black border border-zinc-800 p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
              <FileText className="w-4 h-4 text-white" />
              2. Select Target File & Download
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase mb-1">Target File</label>
                <select
                  value={selectedFileId}
                  onChange={(e) => setSelectedFileId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-white font-mono focus:border-white focus:outline-none"
                >
                  {files.map((f) => (
                    <option key={f.fileId} value={f.fileId}>
                      {f.originalName} ({f.fileId})
                    </option>
                  ))}
                </select>
              </div>

              {/* Lambda@Edge Function Selector */}
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase mb-1 flex items-center justify-between">
                  <span>⚡ Lambda@Edge Function</span>
                  <span className="text-amber-400 font-bold">AWS Serverless</span>
                </label>
                <select
                  value={selectedEdgeFn}
                  onChange={(e) => setSelectedEdgeFn(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-amber-900/50 px-3 py-2 text-xs text-amber-300 font-mono focus:border-amber-400 focus:outline-none"
                >
                  <option value="none">None (Standard Cache Request)</option>
                  <option value="inject-security-headers">Inject Security Headers (OWASP Response Headers)</option>
                  <option value="geo-personalization">Geo-Personalization (Custom Greeting & Location Header)</option>
                </select>
              </div>

              <button
                onClick={handleFetch}
                disabled={loading || !selectedFileId}
                className="w-full py-3 bg-white text-black font-bold uppercase text-xs hover:bg-zinc-200 transition disabled:opacity-30 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>ROUTING & FETCHING...</>
                ) : (
                  <>
                    <Download className="w-4 h-4" /> INITIATE CDN REQUEST
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Metrics Results Card */}
          {metrics && (
            <div className="bg-black border border-white p-5">
              <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
                <CheckCircle2 className="w-4 h-4 text-white" />
                Response Metrics
              </h2>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between border-b border-zinc-900 pb-1">
                  <span className="text-zinc-500">Routing Mode</span>
                  {metrics.routingMode === 'manual' ? (
                    <span className="px-2 py-0.5 bg-amber-950/30 border border-amber-400 text-amber-300 font-bold text-[10px] uppercase">
                      Manual Override
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 border border-zinc-700 text-zinc-300 font-bold text-[10px] uppercase">
                      Auto (Haversine + Load)
                    </span>
                  )}
                </div>
                <div className="flex justify-between border-b border-zinc-900 pb-1">
                  <span className="text-zinc-500">Target Node</span>
                  <span className="text-white font-bold">{metrics.selectedNodeName} ({metrics.selectedNodeId})</span>
                </div>
                <div className="flex justify-between border-b border-zinc-900 pb-1">
                  <span className="text-zinc-500">Haversine Distance</span>
                  <span className="text-white font-mono">{metrics.distanceKm} km</span>
                </div>
                <div className="flex justify-between border-b border-zinc-900 pb-1">
                  <span className="text-zinc-500">Total Latency</span>
                  <span className="text-white font-mono">{metrics.totalLatencyMs} ms</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-zinc-500">Cache Status</span>
                  <span className="px-2 py-0.5 bg-white text-black font-bold text-[10px] uppercase">
                    {metrics.cacheStatus}
                  </span>
                </div>

                {metrics.lambdaFnExecuted && (
                  <div className="pt-2 border-t border-zinc-900 space-y-1 text-[11px]">
                    <div className="flex justify-between text-amber-400 font-bold">
                      <span>⚡ Lambda@Edge Function</span>
                      <span>{metrics.lambdaFnExecuted}</span>
                    </div>
                    {metrics.lambdaGreeting && (
                      <div className="text-zinc-400 text-[10px] italic">
                        "{metrics.lambdaGreeting}"
                      </div>
                    )}
                  </div>
                )}

                {downloadBlobUrl && (
                  <div className="pt-3 border-t border-zinc-800">
                    <a
                      href={downloadBlobUrl}
                      download={`cdn-download-${selectedFileId}`}
                      className="block text-center py-2 border border-zinc-700 bg-zinc-900 hover:bg-white hover:text-black text-xs font-bold uppercase transition"
                    >
                      DOWNLOAD FILE CONTENT
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right 2 Columns: Live Request Execution Timeline */}
        <div className="lg:col-span-2 bg-black border border-zinc-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
            <Clock className="w-4 h-4 text-white" />
            Live Request Step Execution Timeline
          </h2>

          <div className="space-y-3 font-mono text-xs">
            {timeline.map((t) => (
              <div
                key={t.step}
                className={`p-3 border transition-all ${
                  t.status === 'completed'
                    ? 'border-zinc-700 bg-zinc-950 text-white'
                    : t.status === 'running'
                    ? 'border-white bg-zinc-900 text-white'
                    : 'border-zinc-900 bg-black text-zinc-600'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold flex items-center gap-2">
                    <span
                      className={`w-5 h-5 flex items-center justify-center text-[10px] border ${
                        t.status === 'completed'
                          ? 'border-white bg-white text-black font-bold'
                          : 'border-zinc-800 text-zinc-500'
                      }`}
                    >
                      {t.step}
                    </span>
                    {t.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider">
                    {t.status === 'completed' ? '✓ DONE' : t.status === 'running' ? '⚡ RUNNING' : 'PENDING'}
                  </span>
                </div>
                <p className="text-zinc-400 text-[11px] pl-7">{t.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
