const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc, query, orderBy, onSnapshot, getDocs, Timestamp } = require("firebase/firestore");

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

initializeApp(firebaseConfig);
const db = getFirestore();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.json());

const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch(error => {
    console.log('Error connecting to MongoDB', error);
  });

const User = require('./models/user');
const Chat = require('./models/message');

// User registration
app.post('/register', async (req, res) => {
  try {
    const userData = req.body;
    const newUser = new User(userData);
    await newUser.save();
    const secretKey = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign({ userId: newUser._id }, secretKey, { expiresIn: '1d' });
    res.status(201).json({ token });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get user by ID
app.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(500).json({ message: 'User not found' });
    }
    return res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching the user details' });
  }
});

// User login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (user.password !== password) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const secretKey = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign({ userId: user._id }, secretKey, { expiresIn: '1d' });
    return res.status(200).json({ token });
  } catch (error) {
    res.status(500).json({ message: 'Login failed' });
  }
});
// location
// Endpoint to update the user's location in MongoDB
// Endpoint to update the user's location in MongoDB
app.post('/updateLocation', async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    // Validate the required fields
    if (!userId || latitude == null || longitude == null) {
      return res.status(400).json({ message: 'Missing required fields: userId, latitude, longitude' });
    }

    // Find the user in MongoDB
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if location is null or needs to be updated
    if (!user.location || user.location.latitude !== latitude || user.location.longitude !== longitude) {
      user.location = { latitude, longitude }; // Update or initialize the location field
      user.updatedAt = new Date(); // Update the timestamp
      await user.save(); // Save the updated user data
      return res.status(200).json({ message: 'Location updated successfully' });
    }

    // If location is already up-to-date
    return res.status(200).json({ message: 'Location is already up-to-date' });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Fetch matches
app.get('/matches', async (req, res) => {
  try {
    const { userId } = req.query;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let filter = {};
    if (user.gender === 'Men') {
      filter.gender = 'Women';
    } else if (user.gender === 'Women') {
      filter.gender = 'Men';
    }

    if (user.type) {
      filter.type = user.type;
    }

    const currentUser = await User.findById(userId)
      .populate('matches', '_id')
      .populate('likedProfiles', '_id');
    const friendIds = currentUser.matches.map(friend => friend._id);
    const crushIds = currentUser.likedProfiles.map(crush => crush._id);

    const matches = await User.find(filter)
      .where('_id')
      .nin([userId, ...friendIds, ...crushIds]);

    return res.status(200).json({ matches });
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Like a profile
app.post('/like-profile', async (req, res) => {
  try {
    const { userId, likedUserId, image, comment } = req.body;
    await User.findByIdAndUpdate(likedUserId, {
      $push: {
        receivedLikes: {
          userId: userId,
          image: image,
          comment: comment,
        },
      },
    });
    await User.findByIdAndUpdate(userId, {
      $push: {
        likedProfiles: likedUserId,
      },
    });

    res.status(200).json({ message: 'Profile liked successfully' });
  } catch (error) {
    console.error('Error liking profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get received likes
app.get('/received-likes/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const likes = await User.findById(userId)
      .populate('receivedLikes.userId', 'firstName imageUrls prompts')
      .select('receivedLikes');

    res.status(200).json({ receivedLikes: likes.receivedLikes });
  } catch (error) {
    console.error('Error fetching received likes:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create a match
app.post('/create-match', async (req, res) => {
  try {
    const { currentUserId, selectedUserId } = req.body;
    await User.findByIdAndUpdate(selectedUserId, {
      $push: { matches: currentUserId },
      $pull: { likedProfiles: currentUserId },
    });
    await User.findByIdAndUpdate(currentUserId, {
      $push: { matches: selectedUserId },
      $pull: { receivedLikes: { userId: selectedUserId } },
    });

    res.status(200).json({ message: 'Match created successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error creating a match', error });
  }
});

// Get matches for a user
app.get('/get-matches/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).populate('matches', 'firstName imageUrls');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const matches = user.matches;
    res.status(200).json({ matches });
  } catch (error) {
    console.error('Error getting matches:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Send a message to Firestore
app.post('/send-message', async (req, res) => {
  try {
    const { senderId, receiverId, message } = req.body;
    await addDoc(collection(db, 'messages'), {
      senderId,
      receiverId,
      message,
      timestamp: Timestamp.now()
    });
    res.status(200).json({ message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'Error sending message' });
  }
});

// Get messages between users
// Get messages between users from Firestore
app.get('/messages', async (req, res) => {
  try {
    const { senderId, receiverId } = req.query;

    // Reference to the messages collection in Firestore
    const messagesRef = collection(db, 'messages');
    
    // Query to get all messages between sender and receiver, ordered by timestamp
    const q = query(messagesRef, orderBy('timestamp'));
    
    // Fetch all messages
    const snapshot = await getDocs(q);
    
    // Filter messages to find those between senderId and receiverId
    const messages = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      
      .filter(msg => 
        (msg.senderId === senderId && msg.receiverId === receiverId) ||
        (msg.senderId === receiverId && msg.receiverId === senderId)
      );

    res.status(200).json(messages);
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ message: 'Error getting messages', error });
  }
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
