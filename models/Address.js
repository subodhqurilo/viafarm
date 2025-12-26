const mongoose = require("mongoose");
const { addressToCoords, coordsToAddress } = require("../utils/geocode");

const AddressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ---- Address Fields ----
    pinCode: { type: String, trim: true },
    houseNumber: { type: String, trim: true },
    street: { type: String, trim: true },
    locality: { type: String, trim: true },
    city: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true, default: "Delhi" },

    isDefault: { type: Boolean, default: false },

    // ---- GeoJSON Location ----
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
  },
  { timestamps: true }
);

/* =====================================================
   📍 PRE-SAVE: AUTO GEO / REVERSE GEO
===================================================== */
AddressSchema.pre("save", async function (next) {
  try {
    const address = this;

    /* ------------------------------
       1️⃣ Address → Coordinates
    ------------------------------ */
    const hasCoords =
      Array.isArray(address.location?.coordinates) &&
      address.location.coordinates.length === 2 &&
      address.location.coordinates[0] !== 0;

    if (
      !hasCoords &&
      address.city &&
      address.state &&
      address.pinCode
    ) {
      const addressStr = [
        address.houseNumber,
        address.street,
        address.locality,
        address.city,
        address.district,
        address.state,
        address.pinCode,
      ]
        .filter(Boolean)
        .join(", ");

      const coords = await addressToCoords(addressStr);

      if (coords && coords.length === 2) {
        address.location = {
          type: "Point",
          coordinates: coords, // [lng, lat]
        };
      }
    }

    /* ------------------------------
       2️⃣ Coordinates → Address
    ------------------------------ */
    else if (
      hasCoords &&
      (!address.city || !address.pinCode)
    ) {
      const [lng, lat] = address.location.coordinates;

      const addrData = await coordsToAddress(lat, lng);
      if (addrData) {
        address.city = address.city || addrData.city;
        address.state = address.state || addrData.state;
        address.district = address.district || addrData.district;
        address.pinCode = address.pinCode || addrData.pinCode;
      }
    }

    next();
  } catch (err) {
    console.error("❌ Address pre-save error:", err);
    next(); // never block save
  }
});

/* =====================================================
   📌 INDEXES (VERY IMPORTANT)
===================================================== */
AddressSchema.index({ user: 1, isDefault: 1 });
AddressSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Address", AddressSchema);
