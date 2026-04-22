import { analyzeStudentWork } from "../server/gemini.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { question, imageBase64, analysisImages } = req.body ?? {};
    const feedback = await analyzeStudentWork(question, imageBase64, analysisImages);
    return res.status(200).json(feedback);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return res.status(500).json({ error: message });
  }
}
