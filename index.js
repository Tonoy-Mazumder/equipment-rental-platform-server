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
const equipmentCollection = database.collection("equipment");
console.log("Database:", database.databaseName);

app.get("/", (req, res) => {
  res.send("RentPro server is running!");
});

app.get("/equipment", async (req, res) => {
  try {
    const equipment = await equipmentCollection.find().toArray();

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

app.post("/equipment", async (req, res) => {
  try {
    const {
      ownerId,
      name,
      category,
      description,
      pricePerDay,
      location,
      images,
    } = req.body;

    if (
      !ownerId ||
      !name ||
      !category ||
      !description ||
      !pricePerDay ||
      !location
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const newEquipment = {
      ownerId,
      name,
      category,
      description,
      pricePerDay: Number(pricePerDay),
      location,
      images: images || [],
      status: "available",
      createdAt: new Date(),
    };

    const result = await equipmentCollection.insertOne(newEquipment);
    res.status(201).json({
      success: true,
      message: "Equipment added successfully",
      data: {
        _id: result.insertedId,
        ...newEquipment,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to add equipment",
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
