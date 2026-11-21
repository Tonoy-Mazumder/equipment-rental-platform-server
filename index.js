
import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

const mongoUrl = process.env.MONGODB_URL;

if (!mongoUrl) {
  throw new Error("MONGODB_URL is missing");
}

const client = new MongoClient(mongoUrl);

export async function connectToMongoDB() {
  await client.connect();

  console.log("Successfully connected to MongoDB!");

  return client;
}

async function startServer() {
  try {
    const connectedClient = await connectToMongoDB();

    const database = connectedClient.db("RentPro");

    console.log("Database:", database.databaseName);

    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

app.get("/", (req, res) => {
  res.send("RentPro server is running!");
});

startServer();
