import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:5000",
    credentials: true,
  }),
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

const connectedClient = await connectToMongoDB();

const database = connectedClient.db("RentPro");

console.log("Database:", database.databaseName);

app.get("/", (req, res) => {
  res.send("RentPro server is running!");
});


app.get("/equipment", async (req, res) => {
  try {
    const equipment = await database
      .collection("equipment")
      .find()
      .toArray();

    res.status(200).json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
