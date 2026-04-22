import { Question, Feedback } from "../types";

export async function checkStudentWork(question: Question, imageBase64: string): Promise<Feedback> {
  const response = await fetch("/api/check-student-work", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question,
      imageBase64,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "AI failed to provide feedback.");
  }

  return (await response.json()) as Feedback;
}
