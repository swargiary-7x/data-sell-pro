const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not configured.");
}

/* =========================
   BASIC ROUTES
========================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Data Sell Pro Backend is running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is working"
  });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS time");

    res.json({
      success: true,
      database: "connected",
      time: result.rows[0].time
    });
  } catch (error) {
    console.error("Database error:", error.message);

    res.status(500).json({
      success: false,
      database: "connection failed"
    });
  }
});

/* =========================
   REFERRAL CODE
========================= */

function generateReferralCode() {
  const random = Math.floor(100000 + Math.random() * 900000);
  return `REF${random}`;
}

/* =========================
   REGISTER
========================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      full_name,
      email,
      mobile,
      password,
      referred_by
    } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, email and password are required"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const existingUser = await pool.query(
      "SELECT id FROM public.users WHERE email = $1",
      [cleanEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already registered"
      });
    }

    const passwordHash = await argon2.hash(password);

    let referralCode;
    let referralExists = true;

    while (referralExists) {
      referralCode = generateReferralCode();

      const check = await pool.query(
        "SELECT id FROM public.users WHERE referral_code = $1",
        [referralCode]
      );

      referralExists = check.rows.length > 0;
    }

    let validReferredBy = null;

    if (referred_by) {
      const referrer = await pool.query(
        "SELECT id FROM public.users WHERE referral_code = $1",
        [referred_by.trim()]
      );

      if (referrer.rows.length > 0) {
        validReferredBy = referred_by.trim();
      }
    }

    const result = await pool.query(
      `INSERT INTO public.users
      (
        full_name,
        email,
        mobile,
        password_hash,
        referral_code,
        referred_by,
        wallet_balance,
        total_earnings,
        kyc_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,0.00,0.00,'pending')
      RETURNING
        id,
        full_name,
        email,
        mobile,
        referral_code,
        wallet_balance,
        total_earnings,
        kyc_status,
        created_at`,
      [
        full_name.trim(),
        cleanEmail,
        mobile ? mobile.trim() : null,
        passwordHash,
        referralCode,
        validReferredBy
      ]
    );

    const user = result.rows[0];

    if (!JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Server authentication is not configured"
      });
    }

    const token = jwt.sign(
      {
        userId: user.id
      },
      JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user
    });

  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT
        id,
        full_name,
        email,
        mobile,
        password_hash,
        referral_code,
        referred_by,
        wallet_balance,
        total_earnings,
        kyc_status,
        created_at
       FROM public.users
       WHERE email = $1`,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const user = result.rows[0];

    const passwordCorrect = await argon2.verify(
      user.password_hash,
      password
    );

    if (!passwordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    if (!JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Server authentication is not configured"
      });
    }

    const token = jwt.sign(
      {
        userId: user.id
      },
      JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    delete user.password_hash;

    res.json({
      success: true,
      message: "Login successful",
      token,
      user
    });

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

/* =========================
   AUTH MIDDLEWARE
========================= */

function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    const token = authHeader.split(" ")[1];

    if (!JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Server authentication is not configured"
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId = decoded.userId;

    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
}

/* =========================
   CURRENT USER
========================= */

app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id,
        full_name,
        email,
        mobile,
        referral_code,
        referred_by,
        wallet_balance,
        total_earnings,
        kyc_status,
        created_at
       FROM public.users
       WHERE id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("User error:", error);

    res.status(500).json({
      success: false,
      message: "Could not load user"
    });
  }
});

/* =========================
   DASHBOARD
========================= */

app.get("/api/dashboard", authenticate, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT
        id,
        full_name,
        email,
        mobile,
        referral_code,
        wallet_balance,
        total_earnings,
        kyc_status,
        created_at
       FROM public.users
       WHERE id = $1`,
      [req.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const user = userResult.rows[0];

    const referralResult = await pool.query(
      `SELECT COUNT(*)::int AS total_referrals
       FROM public.users
       WHERE referred_by = $1`,
      [user.referral_code]
    );

    const transactionResult = await pool.query(
      `SELECT
        id,
        type,
        amount,
        description,
        created_at
       FROM public.transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.userId]
    );

    res.json({
      success: true,
      user,
      total_referrals: referralResult.rows[0].total_referrals,
      transactions: transactionResult.rows
    });

  } catch (error) {
    console.error("Dashboard error:", error);

    res.status(500).json({
      success: false,
      message: "Could not load dashboard"
    });
  }
});

/* =========================
   SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Data Sell Pro server running on port ${PORT}`);
});
