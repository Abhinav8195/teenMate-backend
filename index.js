const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc, query, orderBy, onSnapshot, getDocs, Timestamp, doc,getDoc, setDoc } = require("firebase/firestore");

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
// const Chat = require('./models/message');

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


//firebase
// app.post('/updateLocation', async (req, res) => {
//   try {
//     const { userId, latitude, longitude } = req.body;
//     const locationDocRef = doc(db, 'locations', userId);
//     await setDoc(locationDocRef, {
//       userId,
//       location: { latitude, longitude },
//       updatedAt: Timestamp.now() 
//     });

//     res.status(200).json({ message: 'Location updated successfully' });
//   } catch (error) {
//     console.error('Error updating location:', error);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });


//get location
//firebase
// app.get('/getLocation/:userId', async (req, res) => {
//   try {
//     const { userId } = req.params;

//     const userRef = doc(db, 'locations', userId);
//     const userSnap = await getDoc(userRef);

//     if (!userSnap.exists()) {
//       return res.status(404).json({ message: 'User not found' });
//     }
//     const userData = userSnap.data();
//     const location = userData.location || null;

//     res.status(200).json({ location });
//   } catch (error) {
//     console.error('Error fetching location:', error);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });
app.post('/updateLocation', async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.location = { latitude, longitude };
    await user.save();

    res.status(200).json({ message: 'Location updated successfully' });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

app.get('/nearby-users', async (req, res) => {
  try {
    const { latitude, longitude, radius, userId } = req.query; 

    if (!latitude || !longitude || !radius || !userId) {
      return res.status(400).json({ message: 'Latitude, longitude, radius, and userId are required' });
    }

    // Fetch the current user with populated matches and likedProfiles
    const currentUser = await User.findById(userId)
      .populate('matches', '_id')
      .populate('likedProfiles', '_id');

    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Extract friend and crush IDs
    const friendIds = currentUser.matches.map(friend => friend._id.toString());
    const crushIds = currentUser.likedProfiles.map(crush => crush._id.toString());

    // Determine gender filter based on current user's gender
    let filter = {};
    if (currentUser.gender === 'Men') {
      filter.gender = 'Women';
    } else if (currentUser.gender === 'Women') {
      filter.gender = 'Men';
    }

    // Add type filter if present
    if (currentUser.type) {
      filter.type = currentUser.type;
    }

    // Fetch all users with location data and matching gender/type filter
    const users = await User.find({ location: { $exists: true }, ...filter });

    // Filter users within the specified radius and exclude friends and crushes
    const nearbyUsers = users.filter(user => {
      if (user.location && user._id.toString() !== userId) { 
        const distance = calculateDistance(
          parseFloat(latitude),
          parseFloat(longitude),
          parseFloat(user.location.latitude),
          parseFloat(user.location.longitude)
        );
        return distance <= parseFloat(radius) && 
               !friendIds.includes(user._id.toString()) &&
               !crushIds.includes(user._id.toString());
      }
      return false;
    });

    res.status(200).json({ nearbyUsers });
    console.log('object',nearbyUsers)
  } catch (error) {
    console.error('Error fetching nearby users:', error);
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

    // Fetch the current user with their received likes and matches
    const currentUser = await User.findById(userId)
      .populate('matches', '_id')
      .populate('receivedLikes.userId', 'firstName imageUrls prompts')
      .select('receivedLikes matches');

    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Extract the IDs of the matched profiles
    const matchIds = currentUser.matches.map(match => match._id.toString());

    // Filter received likes to exclude users who are already matches
    const filteredLikes = currentUser.receivedLikes.filter(like => {
      const likeUserId = like.userId._id.toString();
      return !matchIds.includes(likeUserId);
    });

    res.status(200).json({ receivedLikes: filteredLikes });
  } catch (error) {
    console.error('Error fetching received likes:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


//delete
app.delete('/delete-like', async (req, res) => {
  try {
    const { userId, likedUserId } = req.body;

    // Find the user who sent the like
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Find the user who received the like
    const likedUser = await User.findById(likedUserId);
    if (!likedUser) {
      return res.status(404).json({ message: 'Liked user not found' });
    }

    // Remove the like from the sender's receivedLikes array
    user.receivedLikes = user.receivedLikes.filter(like => like.userId.toString() !== likedUserId);
    await user.save();

    // Remove the sender's profile from the liked user's likedProfiles array
    likedUser.likedProfiles = likedUser.likedProfiles.filter(profileId => profileId.toString() !== userId);
    await likedUser.save();

    res.status(200).json({ message: 'Like request deleted successfully' });
  } catch (error) {
    console.error('Error deleting like request:', error);
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
    const { senderId, receiverId, message, image } = req.body;
    await addDoc(collection(db, 'messages'), {
      senderId,
      receiverId,
      message,
      image, 
      timestamp: Timestamp.now(),
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
    const messagesRef = collection(db, 'messages');
    const q = query(messagesRef, orderBy('timestamp'));
    const snapshot = await getDocs(q);
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
