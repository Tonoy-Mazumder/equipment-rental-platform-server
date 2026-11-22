import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { jwtVerify, createRemoteJWKSet } from "jose";
import Stripe from "stripe";
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

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
const favoritesCollection = database.collection("favorites");
const paymentsCollection = database.collection("payments");

app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    console.log("Stripe webhook request received!");
    const signature = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      console.error("Webhook signature verification failed:", error.message);

      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        if (session.payment_status !== "paid") {
          return res.status(200).json({
            received: true,
            message: "Payment is not completed yet",
          });
        }

        const { equipmentId, customerId, ownerId, startDate, endDate } =
          session.metadata;

        if (!equipmentId || !customerId || !ownerId || !startDate || !endDate) {
          throw new Error("Missing checkout metadata");
        }

        // Check if booking already exists
        let booking = await bookingCollection.findOne({
          checkoutSessionId: session.id,
        });

        // Create booking only once
        if (!booking) {
          const bookingData = {
            equipmentId,
            customerId,
            ownerId,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            totalPrice: session.amount_total / 100,
            status: "pending",
            paymentStatus: "paid",
            checkoutSessionId: session.id,
            createdAt: new Date(),
          };

          const bookingResult = await bookingCollection.insertOne(bookingData);

          booking = {
            _id: bookingResult.insertedId,
            ...bookingData,
          };
        }

        // Check if payment already exists
        const existingPayment = await paymentsCollection.findOne({
          checkoutSessionId: session.id,
        });

        if (!existingPayment) {
          await paymentsCollection.insertOne({
            checkoutSessionId: session.id,
            paymentIntentId: session.payment_intent,
            bookingId: booking._id.toString(),
            equipmentId,
            customerId,
            ownerId,
            amount: session.amount_total / 100,
            currency: session.currency,
            status: "paid",
            createdAt: new Date(),
          });
        }

        console.log("Booking and payment saved:", session.id);
      } catch (error) {
        console.error("Webhook processing failed:", error);

        return res.status(500).json({
          received: false,
          message: "Failed to save booking and payment",
        });
      }
    }

    res.status(200).json({ received: true });
  },
);

app.use(express.json());
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
    const search = req.query.search || "";
    const category = req.query.category;

    const filter = {
      approvalStatus: "approved",
    };

    if (search) {
      filter.name = {
        $regex: search,
        $options: "i",
      };
    }

    if (category) {
      filter.category = category;
    }

    const equipment = await equipmentCollection
      .find(filter)
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
app.post("/bookings", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const { equipmentId, startDate, endDate, totalPrice } = req.body;

    if (!equipmentId || !startDate || !endDate || totalPrice === undefined) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    if (!ObjectId.isValid(equipmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(equipmentId),
      approvalStatus: "approved",
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found or not approved",
      });
    }

    const bookingStart = new Date(startDate);
    const bookingEnd = new Date(endDate);
    const price = Number(totalPrice);

    if (
      isNaN(bookingStart.getTime()) ||
      isNaN(bookingEnd.getTime()) ||
      bookingEnd <= bookingStart ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking information",
      });
    }

    const newBooking = {
      equipmentId,
      customerId: req.user.id,
      ownerId: equipment.ownerId,
      startDate: bookingStart,
      endDate: bookingEnd,
      totalPrice: price,
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
    console.error("Failed to create booking:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create booking",
    });
  }
});

app.post(
  "/create-checkout-session",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { equipmentId, startDate, endDate } = req.body;

      if (!equipmentId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Please provide all required fields",
        });
      }

      if (!ObjectId.isValid(equipmentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
      }

      const equipment = await equipmentCollection.findOne({
        _id: new ObjectId(equipmentId),
        approvalStatus: "approved",
      });

      if (!equipment) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found or not approved",
        });
      }

      const bookingStart = new Date(startDate);
      const bookingEnd = new Date(endDate);

      if (
        isNaN(bookingStart.getTime()) ||
        isNaN(bookingEnd.getTime()) ||
        bookingEnd <= bookingStart
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking dates",
        });
      }

      const days =
        Math.ceil((bookingEnd - bookingStart) / (1000 * 60 * 60 * 24)) + 1;

      const rentalPrice = days * Number(equipment.pricePerDay);
      const serviceFee = Math.round((rentalPrice * 5) / 100);
      const totalPrice = rentalPrice + serviceFee;

      if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment price",
        });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: equipment.name,
              },
              unit_amount: Math.round(totalPrice * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          equipmentId,
          customerId: req.user.id,
          ownerId: equipment.ownerId,
          startDate: bookingStart.toISOString(),
          endDate: bookingEnd.toISOString(),
          totalPrice: String(totalPrice),
        },
        success_url:
          "http://localhost:3000/payment/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "http://localhost:3000/payment/cancel",
      });

      res.status(200).json({
        success: true,
        checkoutUrl: session.url,
      });
    } catch (error) {
      console.error("Checkout session error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to create checkout session",
      });
    }
  },
);
app.get("/bookings/customer", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const bookings = await bookingCollection
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (error) {
    console.error("Failed to fetch customer bookings:", error);

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

// Get single booking (Customer, Owner, or Admin)

app.get("/bookings/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const isCustomer = booking.customerId === req.user.id;
    const isOwner = booking.ownerId === req.user.id;
    const isAdmin = req.user.role === "admin";

    if (!isCustomer && !isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this booking",
      });
    }

    res.status(200).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    console.error("Failed to fetch booking:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch booking",
    });
  }
});

// Cancel booking (Only booking owner/customer can cancel)
app.patch(
  "/bookings/:id/cancel",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID",
        });
      }

      const result = await bookingCollection.updateOne(
        {
          _id: new ObjectId(id),
          customerId: req.user.id,
          status: { $in: ["pending", "approved"] },
        },
        {
          $set: {
            status: "cancelled",
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Booking not found or cannot be cancelled",
        });
      }

      res.status(200).json({
        success: true,
        message: "Booking cancelled successfully",
      });
    } catch (error) {
      console.error("Failed to cancel booking:", error);

      res.status(500).json({
        success: false,
        message: "Failed to cancel booking",
      });
    }
  },
);

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

// Add equipment to favorites
app.post("/favorites", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const { equipmentId } = req.body;

    if (!equipmentId || !ObjectId.isValid(equipmentId)) {
      return res.status(400).json({
        success: false,
        message: "Valid equipment ID is required",
      });
    }

    // Check equipment exists and is approved
    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(equipmentId),
      approvalStatus: "approved",
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    // Check if already favorited
    const existingFavorite = await favoritesCollection.findOne({
      customerId: req.user.id,
      equipmentId,
    });

    if (existingFavorite) {
      return res.status(409).json({
        success: false,
        message: "Equipment is already in favorites",
      });
    }

    await favoritesCollection.insertOne({
      customerId: req.user.id,
      equipmentId,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Equipment added to favorites",
    });
  } catch (error) {
    console.error("Failed to add favorite:", error);

    res.status(500).json({
      success: false,
      message: "Failed to add favorite",
    });
  }
});

// Get customer favorites
app.get("/favorites", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const favorites = await favoritesCollection
      .aggregate([
        {
          $match: {
            customerId: req.user.id,
          },
        },
        {
          $addFields: {
            equipmentObjectId: {
              $toObjectId: "$equipmentId",
            },
          },
        },
        {
          $lookup: {
            from: "equipment",
            localField: "equipmentObjectId",
            foreignField: "_id",
            as: "equipment",
          },
        },
        {
          $unwind: "$equipment",
        },
        {
          $project: {
            equipmentObjectId: 0,
          },
        },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      data: favorites,
    });
  } catch (error) {
    console.error("Failed to fetch favorites:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch favorites",
    });
  }
});

// Remove equipment from favorites
app.delete(
  "/favorites/:equipmentId",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { equipmentId } = req.params;

      if (!ObjectId.isValid(equipmentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
      }

      const result = await favoritesCollection.deleteOne({
        customerId: req.user.id,
        equipmentId,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Favorite not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Favorite removed successfully",
      });
    } catch (error) {
      console.error("Failed to remove favorite:", error);

      res.status(500).json({
        success: false,
        message: "Failed to remove favorite",
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
            paymentStatus: 1,
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

// Update rental booking status by admin
app.patch(
  "/admin/rentals/:id/status",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid rental ID",
        });
      }

      const allowedStatuses = [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "completed",
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid rental status",
        });
      }

      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
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
          message: "Rental not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Rental status updated successfully",
      });
    } catch (error) {
      console.error("Admin rental status update error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update rental status",
      });
    }
  },
);

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
        return res.status(400).json({
          success: false,
          message: "Invalid user ID",
        });
      }

      const allowedRoles = ["customer", "owner", "admin"];

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role",
        });
      }

      const user = await userCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Protect existing admin accounts
      if (user.role === "admin") {
        return res.status(403).json({
          success: false,
          message: "Admin role cannot be changed",
        });
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

// Update equipment by Admin
app.patch(
  "/admin/equipment/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, category, description, pricePerDay, location, images } =
        req.body;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      if (
        !name?.trim() ||
        !category?.trim() ||
        !description?.trim() ||
        !location?.trim() ||
        !Array.isArray(images) ||
        typeof pricePerDay !== "number" ||
        pricePerDay <= 0
      ) {
        res.status(400).json({
          success: false,
          message: "Please provide valid equipment information",
        });
        return;
      }

      const result = await equipmentCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            name: name.trim(),
            category: category.trim(),
            description: description.trim(),
            pricePerDay,
            location: location.trim(),
            images,
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
        message: "Equipment updated successfully",
      });
    } catch (error) {
      console.error("Failed to update equipment:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update equipment",
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

// Admin Analytics

app.get("/admin/analytics", verifyToken, verifyAdmin, async (req, res) => {
  try {
    // User statistics
    const totalUsers = await userCollection.countDocuments();

    const totalCustomers = await userCollection.countDocuments({
      role: "customer",
    });

    const totalOwners = await userCollection.countDocuments({
      role: "owner",
    });

    const totalAdmins = await userCollection.countDocuments({
      role: "admin",
    });

    // Equipment statistics
    const totalEquipment = await equipmentCollection.countDocuments();

    const pendingEquipment = await equipmentCollection.countDocuments({
      approvalStatus: "pending",
    });

    const approvedEquipment = await equipmentCollection.countDocuments({
      approvalStatus: "approved",
    });

    const rejectedEquipment = await equipmentCollection.countDocuments({
      approvalStatus: "rejected",
    });

    // Rental statistics
    const totalRentals = await bookingCollection.countDocuments();

    const pendingRentals = await bookingCollection.countDocuments({
      status: "pending",
    });

    const approvedRentals = await bookingCollection.countDocuments({
      status: "approved",
    });

    const cancelledRentals = await bookingCollection.countDocuments({
      status: "cancelled",
    });

    const completedRentals = await bookingCollection.countDocuments({
      status: "completed",
    });

    // Monthly booking statistics
    const currentYear = new Date().getFullYear();

    const monthlyBookings = await bookingCollection
      .aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
              $lt: new Date(`${currentYear + 1}-01-01T00:00:00.000Z`),
            },
          },
        },
        {
          $group: {
            _id: {
              $month: "$createdAt",
            },
            total: {
              $sum: 1,
            },
          },
        },
        {
          $sort: {
            _id: 1,
          },
        },
      ])
      .toArray();

    const monthlyBookingStats = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;

      const booking = monthlyBookings.find((item) => item._id === month);

      return {
        month,
        total: booking?.total || 0,
      };
    });

    // Revenue from successful payments
    const revenueResult = await paymentsCollection
      .aggregate([
        {
          $match: {
            status: "paid",
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: "$amount",
            },
          },
        },
      ])
      .toArray();

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    // Send analytics response
    res.status(200).send({
      success: true,
      data: {
        users: {
          total: totalUsers,
          customers: totalCustomers,
          owners: totalOwners,
          admins: totalAdmins,
        },

        equipment: {
          total: totalEquipment,
          pending: pendingEquipment,
          approved: approvedEquipment,
          rejected: rejectedEquipment,
        },

        rentals: {
          total: totalRentals,
          pending: pendingRentals,
          approved: approvedRentals,
          cancelled: cancelledRentals,
          completed: completedRentals,
        },

        totalRevenue,
        monthlyBookingStats,
      },
    });
  } catch (error) {
    console.error("Admin analytics error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load admin analytics",
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
