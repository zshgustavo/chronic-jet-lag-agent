import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.post("/api/flights", async (req, res) => {
    try {
      const { departure_id, arrival_id, outbound_date, airline } = req.body;
      const apiKey = process.env.SERPAPI_API_KEY;
      
      if (!apiKey) {
        return res.status(400).json({ error: 'SERPAPI_API_KEY environment variable is required to search flights. Please configure it in the settings.' });
      }

      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.append('engine', 'google_flights');
      url.searchParams.append('departure_id', departure_id);
      url.searchParams.append('arrival_id', arrival_id);
      url.searchParams.append('outbound_date', outbound_date);
      url.searchParams.append('hl', 'en');
      url.searchParams.append('currency', 'USD');
      url.searchParams.append('api_key', apiKey);

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.error) {
        return res.status(400).json({ error: data.error });
      }

      let flights = data.best_flights || data.other_flights || [];
      
      if (airline) {
        flights = flights.filter((f: any) => 
          f.flights.some((segment: any) => 
            segment.airline.toLowerCase().includes(airline.toLowerCase())
          )
        );
      }

      const simplifiedFlights = flights.slice(0, 10).map((f: any) => ({
        price: f.price,
        duration: f.total_duration,
        airline: f.flights.map((seg: any) => seg.airline).join(', '),
        departure: f.flights[0].departure_airport.time,
        arrival: f.flights[f.flights.length - 1].arrival_airport.time,
        layovers: f.layovers ? f.layovers.length : 0
      }));

      res.json({ flights: simplifiedFlights });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
