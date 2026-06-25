const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const sheetsService = require('../services/sheetsService');
const authMiddleware = require('../middleware/auth');
const analyticsCache = require('../services/analyticsCache');

// Middleware to restrict access to Super HR only
function superHrOnly(req, res, next) {
  if (req.user.role !== 'Super HR') {
    return res.status(403).json({ success: false, error: 'Permission denied. Only Super HR accounts can manage system users.' });
  }
  next();
}

// 1. GET all users
router.get('/', authMiddleware, superHrOnly, async (req, res) => {
  try {
    const rawUsers = await sheetsService.getAllUsers();
    // Return mapped fields with camelCase for frontend compatibility
    const users = rawUsers.map(u => ({
      id: parseInt(u.UserID) || u.UserID,
      name: u.Name || "",
      email: u.Email || "",
      role: u.Role || "",
      location: u.Location || "",
      status: u.Status || "Active",
      createdDate: u.CreatedDate || ""
    }));
    return res.json({ success: true, users });
  } catch (err) {
    console.error('Fetch Users Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while fetching users.'
        : 'Failed to fetch users: ' + sanitizedError 
    });
  }
});

// 2. POST create a new user (with default password PGP@2024)
router.post('/', authMiddleware, superHrOnly, async (req, res) => {
  const { name, email, role, location, password } = req.body;

  if (!name || !email || !role) {
    return res.status(400).json({ success: false, error: 'Name, email, and role are required.' });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address format.' });
  }

  // Role validation
  if (role !== 'Super HR' && role !== 'Branch HR') {
    return res.status(400).json({ success: false, error: 'Invalid role. Valid roles are "Super HR" and "Branch HR".' });
  }

  // Location validation — dynamic: valid branches are derived from actual apprentice data
  let userLocation = location;
  if (role === 'Super HR') {
    userLocation = 'All Locations';
  } else {
    if (!location || !location.trim()) {
      return res.status(400).json({ success: false, error: 'Branch HR must be assigned to a valid branch location.' });
    }
    // Derive valid branches from live data (cache-warm — no extra API call)
    try {
      const activeRaw = await sheetsService.getActiveApprentices();
      const completedRaw = await sheetsService.getCompletedApprentices();
      const locationSet = new Set();
      [...activeRaw, ...completedRaw].forEach(row => {
        const loc = String(row['Location'] || '').trim();
        if (loc) locationSet.add(loc.toLowerCase());
      });
      if (!locationSet.has(location.trim().toLowerCase())) {
        return res.status(400).json({ success: false, error: `Invalid branch location: "${location}". Only locations present in the apprentice data are valid.` });
      }
    } catch (locErr) {
      console.warn('Could not validate location dynamically, skipping check:', locErr.message);
      // Non-fatal: allow creation if location check fails (service might be warming up)
    }
    userLocation = location.trim();
  }

  try {
    const rawUsers = await sheetsService.getAllUsers();
    
    // Check duplicate email
    const duplicate = rawUsers.find(u => String(u.Email).toLowerCase().trim() === String(email).toLowerCase().trim());
    if (duplicate) {
      return res.status(400).json({ success: false, error: `Email address ${email} is already registered.` });
    }

    // Generate UserID
    let maxId = 0;
    rawUsers.forEach(u => {
      const idNum = parseInt(u.UserID);
      if (!isNaN(idNum) && idNum > maxId) {
        maxId = idNum;
      }
    });
    const nextId = maxId + 1;

    // Hash custom password if provided, otherwise default password
    const passwordToHash = password || 'PGP@2024';
    const passwordHash = await bcrypt.hash(passwordToHash, 10);

    const newUser = {
      UserID: nextId,
      Name: name,
      Email: email.toLowerCase().trim(),
      PasswordHash: passwordHash,
      Role: role,
      Location: userLocation,
      Status: 'Active',
      CreatedDate: new Date().toISOString().split('T')[0]
    };

    // Save back to sheets
    rawUsers.push(newUser);
    await sheetsService.saveUsers(rawUsers);
    analyticsCache.invalidate();

    return res.json({
      success: true,
      message: 'User registered successfully with default password PGP@2024.',
      user: {
        id: nextId,
        name: newUser.Name,
        email: newUser.Email,
        role: newUser.Role,
        location: newUser.Location,
        status: newUser.Status
      }
    });

  } catch (err) {
    console.error('Register User Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to register user: ' + err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]') });
  }
});

// 3. PUT edit a user's details
router.put('/:id', authMiddleware, superHrOnly, async (req, res) => {
  const userId = parseInt(req.params.id);
  const { name, email, role, location, password } = req.body;

  if (isNaN(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid user ID.' });
  }

  // Self-demotion guard: prevent Super HR from changing their own role to Branch HR
  if (parseInt(req.user.id) === userId && role && role !== 'Super HR') {
    return res.status(400).json({ success: false, error: 'Self-demotion is prohibited. You cannot change your own role from Super HR.' });
  }

  // Optional validations if fields are provided
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address format.' });
    }
  }

  if (role && role !== 'Super HR' && role !== 'Branch HR') {
    return res.status(400).json({ success: false, error: 'Invalid role. Valid roles are "Super HR" and "Branch HR".' });
  }

  // Dynamic location validation for edit — derive from live data
  if (role === 'Branch HR' && location) {
    try {
      const activeRaw = await sheetsService.getActiveApprentices();
      const completedRaw = await sheetsService.getCompletedApprentices();
      const locationSet = new Set();
      [...activeRaw, ...completedRaw].forEach(row => {
        const loc = String(row['Location'] || '').trim();
        if (loc) locationSet.add(loc.toLowerCase());
      });
      if (!locationSet.has(location.trim().toLowerCase())) {
        return res.status(400).json({ success: false, error: `Invalid branch location: "${location}". Only locations present in the apprentice data are valid.` });
      }
    } catch (locErr) {
      console.warn('Could not validate location dynamically on edit, skipping check:', locErr.message);
    }
  }

  try {
    const rawUsers = await sheetsService.getAllUsers();
    const userIndex = rawUsers.findIndex(u => parseInt(u.UserID) === userId);

    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Check duplicate email (excluding this user)
    if (email) {
      const duplicate = rawUsers.find(u => parseInt(u.UserID) !== userId && String(u.Email).toLowerCase().trim() === String(email).toLowerCase().trim());
      if (duplicate) {
        return res.status(400).json({ success: false, error: `Email address ${email} is already in use by another account.` });
      }
    }

    // Update details
    const targetRole = role || rawUsers[userIndex].Role;
    rawUsers[userIndex].Name = name || rawUsers[userIndex].Name;
    rawUsers[userIndex].Email = email ? email.toLowerCase().trim() : rawUsers[userIndex].Email;
    rawUsers[userIndex].Role = targetRole;
    rawUsers[userIndex].Location = targetRole === 'Super HR' ? 'All Locations' : (location || rawUsers[userIndex].Location);

    // Hash and update password if provided
    if (password && password.trim() !== '') {
      const passwordHash = await bcrypt.hash(password.trim(), 10);
      rawUsers[userIndex].PasswordHash = passwordHash;
    }

    await sheetsService.saveUsers(rawUsers);
    analyticsCache.invalidate();

    return res.json({ success: true, message: 'User details updated successfully.' });

  } catch (err) {
    console.error('Update User Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update user: ' + err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]') });
  }
});

// 4. POST toggle a user's status between Active and Inactive
router.post('/:id/toggle-status', authMiddleware, superHrOnly, async (req, res) => {
  const userId = parseInt(req.params.id);

  if (isNaN(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid user ID.' });
  }

  // Self-deactivation guard: prevent Super HR from deactivating their own account
  if (parseInt(req.user.id) === userId) {
    return res.status(400).json({ success: false, error: 'Self-deactivation is prohibited. You cannot deactivate your own account.' });
  }

  try {
    const rawUsers = await sheetsService.getAllUsers();
    const userIndex = rawUsers.findIndex(u => parseInt(u.UserID) === userId);

    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const currentStatus = rawUsers[userIndex].Status || 'Active';
    const nextStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    rawUsers[userIndex].Status = nextStatus;

    await sheetsService.saveUsers(rawUsers);
    analyticsCache.invalidate();

    return res.json({ success: true, message: `User status changed to ${nextStatus}.`, nextStatus });

  } catch (err) {
    console.error('Toggle User Status Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while modifying user status.'
        : 'Failed to toggle user status: ' + sanitizedError 
    });
  }
});

module.exports = router;
