import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
    You: {
        type: String,
        required: true
    },
    Cortex: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const chatSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    messages: {
        type: [messageSchema],
        default: []
    },
    lastInteraction: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for efficient queries
chatSchema.index({ chatId: 1, userId: 1 });
chatSchema.index({ lastInteraction: -1 });

// Pre-save middleware to update lastInteraction
chatSchema.pre('save', function(next) {
    this.lastInteraction = new Date();
    next();
});

// Method to add a message
chatSchema.methods.addMessage = function(userMessage, cortexResponse) {
    this.messages.push({
        You: userMessage,
        Cortex: cortexResponse,
        timestamp: new Date()
    });
    this.lastInteraction = new Date();
    return this.save();
};

// Static method to find or create chat
chatSchema.statics.findOrCreate = async function(chatId, userId) {
    let chat = await this.findOne({ chatId });
    if (!chat) {
        chat = await this.create({ chatId, userId, messages: [] });
    }
    return chat;
};

// Static method to get recent chats for a user
chatSchema.statics.getRecentChats = async function(userId, limit = 10) {
    return this.find({ userId })
        .sort({ lastInteraction: -1 })
        .limit(limit)
        .lean();
};

// Static method to delete old chats
chatSchema.statics.deleteOldChats = async function(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    return this.deleteMany({
        lastInteraction: { $lt: cutoffDate }
    });
};

const Chat = mongoose.model("Chat", chatSchema);

export default Chat;