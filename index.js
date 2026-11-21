import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";

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
const bookingCollection = database.collection("bookings");
console.log("Database:", database.databaseName);

app.get("/", (req, res) => {
  res.send("RentPro server is running!");
});

// get all equipment
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
// Get single equipment by ID
app.get("/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    // Find equipment
    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    // Check if equipment exists
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

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
// Get equipment by owner ID
app.get("/equipment/owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;

    const equipment = await equipmentCollection
      .find({ ownerId })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch owner equipment",
    });
  }
});
// add equipment
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

// add bookings
app.post("/bookings", async (req, res) => {
  try {
    const { equipmentId, customerId, ownerId, startDate, endDate, totalPrice } =
      req.body;

    if (
      !equipmentId ||
      !customerId ||
      !ownerId ||
      !startDate ||
      !endDate ||
      totalPrice === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const newBooking = {
      equipmentId,
      customerId,
      ownerId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      totalPrice: Number(totalPrice),
      status: "pending",
      createdAt: new Date(),
    };

    const result = await bookingCollection.insertOne(newBooking);

    res.status(201).json({
      success: true,
      message: "Booking created successfully",
      data: {
        _id: result.insertedId,
        ...newBooking,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create booking",
    });
  }
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
