import express from "express";
import { analyzeStudentWork } from "./gemini.js";

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/check-student-work", async (req, res) => {
  try {
    const { question, imageBase64 } = req.body ?? {};
    const feedback = await analyzeStudentWork(question, imageBase64);
    res.json(feedback);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    res.status(500).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Dev API listening on http://localhost:${port}`);
});
