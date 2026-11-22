import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { jwtVerify, createRemoteJWKSet } from "jose";
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
const userCollection = database.collection("user");
console.log("Database:", database.databaseName);
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;

if (!BETTER_AUTH_URL) {
  throw new Error("BETTER_AUTH_URL is missing");
}

const JWKS = createRemoteJWKSet(new URL(`${BETTER_AUTH_URL}/api/auth/jwks`));
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Token is required.",
      });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: BETTER_AUTH_URL,
      audience: BETTER_AUTH_URL,
    });

    if (!payload.sub) {
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    const userId = payload.sub;

    const user = await userCollection.findOne({
      $or: [
        ...(ObjectId.isValid(userId) ? [{ _id: new ObjectId(userId) }] : []),
        { _id: userId },
        { id: userId },
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      });
    }

    req.user = {
      id: userId,
      role: user.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
}
function verifyRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource",
      });
    }

    next();
  };
}

const verifyAdmin = verifyRole("admin");
const verifyOwner = verifyRole("owner");
const verifyCustomer = verifyRole("customer");
app.get("/", (req, res) => {
  res.send("RentPro server is running!");
});

// Get all equipment

app.get("/equipment", async (req, res) => {
  try {
    const equipment = await equipmentCollection
      .find({ approvalStatus: "approved" })
      .toArray();

    res.status(200).json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    console.error("Failed to fetch equipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});

// Get equipment by logged-in owner
app.get("/equipment/owner", verifyToken, verifyOwner, async (req, res) => {
  try {
    const equipment = await equipmentCollection
      .find({ ownerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    console.error("Failed to fetch owner equipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch owner equipment",
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
    console.error("Failed to fetch equipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});

// add equipment

app.post("/equipment", verifyToken, verifyOwner, async (req, res) => {
  try {
    const { name, category, description, pricePerDay, location, images } =
      req.body;

    if (!name || !category || !description || !pricePerDay || !location) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const newEquipment = {
      ownerId: req.user.id,
      name,
      category,
      description,
      pricePerDay: Number(pricePerDay),
      location,
      images: images || [],
      status: "available",
      approvalStatus: "pending",
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
    console.error("Failed to add equipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to add equipment",
    });
  }
});

// update equipment by id

app.patch("/equipment/:id", verifyToken, verifyOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, description, pricePerDay, location, images } =
      req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    if (!name || !category || !description || !pricePerDay || !location) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const result = await equipmentCollection.updateOne(
      {
        _id: new ObjectId(id),
        ownerId: req.user.id,
      },
      {
        $set: {
          name,
          category,
          description,
          pricePerDay: Number(pricePerDay),
          location,
          images: images || [],
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    res.json({
      success: true,
      message: "Equipment updated successfully",
    });
  } catch (error) {
    console.error("Failed to update equipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update equipment",
    });
  }
});

// Delete equipment by ID (only the owner can delete their equipment)

app.delete("/equipment/:id", verifyToken, verifyOwner, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(id),
      ownerId: req.user.id,
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    const activeBooking = await bookingCollection.findOne({
      equipmentId: id,
      status: { $in: ["pending", "approved"] },
    });

    if (activeBooking) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete equipment with active bookings",
      });
    }

    await equipmentCollection.deleteOne({
      _id: new ObjectId(id),
      ownerId: req.user.id,
    });

    res.json({
      success: true,
      message: "Equipment deleted successfully",
    });
  } catch (error) {
    console.error("Failed to delete equipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete equipment",
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

app.get("/bookings/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const bookings = await bookingCollection
      .find({ customerId })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch customer bookings",
    });
  }
});

app.get("/bookings/owner", verifyToken, verifyOwner, async (req, res) => {
  try {
    const bookings = await bookingCollection
      .aggregate([
        {
          $match: { ownerId: req.user.id },
        },
        {
          $sort: { createdAt: -1 },
        },
        {
          $lookup: {
            from: "user",
            let: { customerId: "$customerId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: "$_id" }, "$$customerId"],
                  },
                },
              },
            ],
            as: "customer",
          },
        },
        {
          $unwind: {
            path: "$customer",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "equipment",
            let: { equipmentId: "$equipmentId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: "$_id" }, "$$equipmentId"],
                  },
                },
              },
            ],
            as: "equipment",
          },
        },
        {
          $unwind: {
            path: "$equipment",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            equipmentId: 1,
            customerId: 1,
            ownerId: 1,
            startDate: 1,
            endDate: 1,
            totalPrice: 1,
            status: 1,
            createdAt: 1,
            customerName: "$customer.name",
            customerEmail: "$customer.email",
            equipmentName: "$equipment.name",
          },
        },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (error) {
    console.error("Failed to fetch owner bookings:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch owner bookings",
    });
  }
});
// Get owner rental history
app.get(
  "/bookings/owner/history",
  verifyToken,
  verifyOwner,
  async (req, res) => {
    try {
      const bookings = await bookingCollection
        .aggregate([
          {
            $match: { ownerId: req.user.id },
          },
          {
            $sort: { createdAt: -1 },
          },
          {
            $lookup: {
              from: "user",
              let: { customerId: "$customerId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [{ $toString: "$_id" }, "$$customerId"],
                    },
                  },
                },
              ],
              as: "customer",
            },
          },
          {
            $lookup: {
              from: "equipment",
              let: { equipmentId: "$equipmentId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [{ $toString: "$_id" }, "$$equipmentId"],
                    },
                  },
                },
              ],
              as: "equipment",
            },
          },
          {
            $unwind: {
              path: "$customer",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $unwind: {
              path: "$equipment",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              equipmentId: 1,
              customerId: 1,
              startDate: 1,
              endDate: 1,
              totalPrice: 1,
              status: 1,
              createdAt: 1,
              customerName: "$customer.name",
              customerEmail: "$customer.email",
              equipmentName: "$equipment.name",
            },
          },
        ])
        .toArray();

      res.status(200).json({
        success: true,
        data: bookings,
      });
    } catch (error) {
      console.error("Failed to fetch rental history:", error);

      res.status(500).json({
        success: false,
        message: "Failed to fetch rental history",
      });
    }
  },
);
// Get single booking by ID
app.get("/bookings/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check booking ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    // Find booking
    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });

    // Check booking exists
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    res.status(200).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch booking",
    });
  }
});
// Cancel a booking by booking ID
app.patch("/bookings/:id/cancel", async (req, res) => {
  try {
    // Get booking ID from URL params
    const { id } = req.params;

    // Check if booking ID is valid
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    // Find the booking
    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });

    // Check if booking exists
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Only pending or approved bookings can be cancelled
    if (!["pending", "approved"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "This booking cannot be cancelled",
      });
    }

    // Update booking status to cancelled
    await bookingCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: "cancelled",
          updatedAt: new Date(),
        },
      },
    );

    // Send success response
    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
    });
  } catch (error) {
    // Log error for debugging
    console.error("Failed to cancel booking:", error);

    // Send error response
    res.status(500).json({
      success: false,
      message: "Failed to cancel booking",
    });
  }
});

// Get all bookings for logged-in owner

// Approve or Reject Booking

app.patch(
  "/bookings/:id/status",
  verifyToken,
  verifyOwner,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID",
        });
      }

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking status",
        });
      }

      const result = await bookingCollection.updateOne(
        {
          _id: new ObjectId(id),
          ownerId: req.user.id,
          status: "pending",
        },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Pending booking not found",
        });
      }

      res.json({
        success: true,
        message: `Booking ${status} successfully`,
      });
    } catch (error) {
      console.error("Failed to update booking status:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update booking status",
      });
    }
  },
);



// Get owner earnings


app.get("/earnings/owner", verifyToken, verifyOwner, async (req, res) => {
  try {
    const bookings = await bookingCollection
      .find({ ownerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    let totalEarnings = 0;
    let pendingEarnings = 0;
    let cancelledAmount = 0;

    const completedBookings = bookings.filter(
      (booking) => booking.status === "completed",
    );

    const approvedBookings = bookings.filter(
      (booking) => booking.status === "approved",
    );

    const cancelledBookings = bookings.filter(
      (booking) => booking.status === "cancelled",
    );

    const monthlyEarnings = Array.from({ length: 12 }, (_, index) => ({
      month: new Date(currentYear, index).toLocaleString("en-US", {
        month: "short",
      }),
      earnings: 0,
    }));

    let thisMonthEarnings = 0;

    for (const booking of completedBookings) {
      const amount = Number(booking.totalPrice) || 0;
      const bookingDate = new Date(booking.endDate);

      totalEarnings += amount;

      if (
        bookingDate.getMonth() === currentMonth &&
        bookingDate.getFullYear() === currentYear
      ) {
        thisMonthEarnings += amount;
      }

      if (bookingDate.getFullYear() === currentYear) {
        monthlyEarnings[bookingDate.getMonth()].earnings += amount;
      }
    }

    for (const booking of approvedBookings) {
      pendingEarnings += Number(booking.totalPrice) || 0;
    }

    for (const booking of cancelledBookings) {
      cancelledAmount += Number(booking.totalPrice) || 0;
    }

    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        thisMonthEarnings,
        pendingEarnings,
        cancelledAmount,
        completedRentals: completedBookings.length,
        transactions: completedBookings.length,
        monthlyEarnings,
        recentTransactions: bookings.slice(0, 5),
      },
    });
  } catch (error) {
    console.error("Failed to fetch owner earnings:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch owner earnings",
    });
  }
});


// Get all users for Admin
app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await userCollection
      .find({})
      .project({
        name: 1,
        email: 1,
        role: 1,
        image: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      totalUsers: users.length,
      data: users,
    });
  } catch (error) {
    console.error("Failed to fetch users:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});

// Get all equipment for Admin
app.get("/admin/equipment", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const equipment = await equipmentCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      totalEquipment: equipment.length,
      data: equipment,
    });
  } catch (error) {
    console.error("Failed to fetch equipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});

// Get all rentals for Admin
app.get("/admin/rentals", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const rentals = await bookingCollection
      .aggregate([
        {
          $sort: { createdAt: -1 },
        },
        {
          $lookup: {
            from: "user",
            let: { customerId: "$customerId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: "$_id" }, "$$customerId"],
                  },
                },
              },
              {
                $project: {
                  name: 1,
                  email: 1,
                },
              },
            ],
            as: "customer",
          },
        },
        {
          $lookup: {
            from: "user",
            let: { ownerId: "$ownerId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: "$_id" }, "$$ownerId"],
                  },
                },
              },
              {
                $project: {
                  name: 1,
                  email: 1,
                },
              },
            ],
            as: "owner",
          },
        },
        {
          $lookup: {
            from: "equipment",
            let: { equipmentId: "$equipmentId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: "$_id" }, "$$equipmentId"],
                  },
                },
              },
              {
                $project: {
                  name: 1,
                  category: 1,
                  location: 1,
                },
              },
            ],
            as: "equipment",
          },
        },
        {
          $project: {
            equipmentId: 1,
            customerId: 1,
            ownerId: 1,
            startDate: 1,
            endDate: 1,
            totalPrice: 1,
            status: 1,
            createdAt: 1,
            customerName: {
              $ifNull: [
                { $arrayElemAt: ["$customer.name", 0] },
                "Unknown Customer",
              ],
            },
            customerEmail: {
              $arrayElemAt: ["$customer.email", 0],
            },
            ownerName: {
              $ifNull: [{ $arrayElemAt: ["$owner.name", 0] }, "Unknown Owner"],
            },
            ownerEmail: {
              $arrayElemAt: ["$owner.email", 0],
            },
            equipmentName: {
              $ifNull: [
                { $arrayElemAt: ["$equipment.name", 0] },
                "Unknown Equipment",
              ],
            },
          },
        },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      totalRentals: rentals.length,
      data: rentals,
    });
  } catch (error) {
    console.error("Failed to fetch rentals:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch rentals",
    });
  }
});

// Update user role by Admin
app.patch(
  "/admin/users/:id/role",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid user ID",
        });
        return;
      }

      if (!["customer", "owner"].includes(role)) {
        res.status(400).json({
          success: false,
          message: "Invalid role. Only customer and owner are allowed.",
        });
        return;
      }

      const user = await userCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      if (user.role === "admin") {
        res.status(403).json({
          success: false,
          message: "Admin role cannot be changed",
        });
        return;
      }

      await userCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            role,
          },
        },
      );

      res.status(200).json({
        success: true,
        message: "User role updated successfully",
      });
    } catch (error) {
      console.error("Failed to update user role:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update user role",
      });
    }
  },
);

// Update equipment approval status by Admin
app.patch(
  "/admin/equipment/:id/approval",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { approvalStatus } = req.body;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      if (!["approved", "rejected"].includes(approvalStatus)) {
        res.status(400).json({
          success: false,
          message: "Invalid approval status",
        });
        return;
      }

      const result = await equipmentCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            approvalStatus,
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Equipment not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Equipment ${approvalStatus} successfully`,
      });
    } catch (error) {
      console.error("Failed to update equipment approval:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update equipment approval",
      });
    }
  },
);

// Admin Equipment Delete API
app.delete(
  "/admin/equipment/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      const equipmentId = new ObjectId(id);

      const equipment = await equipmentCollection.findOne({
        _id: equipmentId,
      });

      if (!equipment) {
        res.status(404).json({
          success: false,
          message: "Equipment not found",
        });
        return;
      }

      const activeBooking = await bookingCollection.findOne({
        equipmentId: id,
        status: { $in: ["pending", "approved"] },
      });

      if (activeBooking) {
        res.status(400).json({
          success: false,
          message: "Cannot delete equipment with active bookings",
        });
        return;
      }

      await equipmentCollection.deleteOne({
        _id: equipmentId,
      });

      res.status(200).json({
        success: true,
        message: "Equipment deleted successfully",
      });
    } catch (error) {
      console.error("Failed to delete equipment:", error);

      res.status(500).json({
        success: false,
        message: "Failed to delete equipment",
      });
    }
  },
);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
