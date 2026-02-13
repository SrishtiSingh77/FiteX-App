import * as FileSystem from 'expo-file-system';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Keep API key in environment variables in production
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE"; // Replace with your actual API key or use environment variables for better security
const MODEL_NAME = "gemini-2.5-flash";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

/**
 * Analyzes a food image and returns detailed nutritional information
 * @param {string} imageUri - Local URI of the image to analyze
 * @returns {Promise<Object>} - Nutritional analysis of the food
 */
export const analyzeFoodImage = async (imageUri) => {
  // Validate input
  if (!imageUri) {
    throw new Error("Image URI is required");
  }

  try {
    // Verify the image exists
    const fileInfo = await FileSystem.getInfoAsync(imageUri);
    if (!fileInfo.exists) {
      throw new Error("Image file not found");
    }

    // Convert image to Base64
    const base64Image = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Initialize the Gemini model
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Create a file part with the base64 image
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/jpeg" // Adjust based on actual image type if needed
      }
    };

    // Construct a clear and detailed prompt
    const prompt = constructPrompt();
    
    // Implement retry logic for API calls
    return await executeWithRetry(async () => {
      // Generate content with the image and prompt
      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text().trim();
      
      // Parse and validate the JSON response
      const jsonContent = extractAndValidateJson(text);
      
      return {
        food: jsonContent.food,
        nutritionInfo: jsonContent.nutritionInfo,
        healthierAlternative: jsonContent.healthierAlternative || "No specific alternative suggested",
        mealType: jsonContent.mealType || "Unknown",
        isDietFriendly: jsonContent.isDietFriendly || {
          keto: false,
          vegan: false,
          vegetarian: false,
          glutenFree: false
        },
        confidence: jsonContent.confidence || "medium",
        // Remove rawResponse in production to save memory
        // Include only in development/debugging builds
        ...(process.env.NODE_ENV === 'development' && { rawResponse: text })
      };
    });
  } catch (error) {
    console.error("Error in food image analysis:", error);
    
    // Provide more descriptive error messages based on error type
    if (error.message.includes("API key")) {
      throw new Error("Authentication failed: Please check your API key configuration");
    } else if (error.message.includes("file not found")) {
      throw new Error("Image access error: The selected image could not be loaded");
    } else if (error.message.includes("valid JSON")) {
      throw new Error("Analysis failed: Unable to process the image content");
    } else {
      throw new Error(`Food analysis failed: ${error.message || "Unknown error occurred"}`);
    }
  }
};

/**
 * Constructs the prompt for the Gemini model
 * @returns {string} The formatted prompt
 */
function constructPrompt() {
  return `
  Analyze this food image and return ONLY a valid JSON object with the structure below.
  Do not include any explanatory text, markdown formatting, code blocks, or any other content - ONLY valid JSON.

  Required JSON structure:
  {
    "food": "Name of the detected food item",
    "nutritionInfo": {
      "calories": "X kcal",
      "protein": "X g",
      "fat": "X g",
      "carbs": "X g",
      "fiber": "X g",
      "sugar": "X g",
      "sodium": "X mg"
    },
    "healthierAlternative": "A healthier alternative with brief explanation",
    "mealType": "Breakfast/Lunch/Dinner/Snack",
    "isDietFriendly": {
      "keto": true/false,
      "vegan": true/false,
      "vegetarian": true/false,
      "glutenFree": true/false
    },
    "confidence": "high/medium/low"
  }

  Make reasonable estimations based on visual appearance. For nutritional values, provide your best estimate based on typical serving size. If you're uncertain about any value, provide your best estimate and set the confidence level accordingly.
  `;
}

/**
 * Extracts and validates the JSON from the AI response
 * @param {string} text - The response text from Gemini
 * @returns {Object} Parsed JSON object
 */
function extractAndValidateJson(text) {
  let jsonContent;
  
  try {
    // First, try to parse the whole response as JSON
    jsonContent = JSON.parse(text);
  } catch (e) {
    // If that fails, look for JSON pattern in the text
    const jsonMatch = text.match(/(\{[\s\S]*\})/);
    if (jsonMatch && jsonMatch[0]) {
      try {
        jsonContent = JSON.parse(jsonMatch[0]);
      } catch (e2) {
        throw new Error("Could not extract valid JSON from the AI response");
      }
    } else {
      throw new Error("No JSON pattern found in the AI response");
    }
  }

  // Validate required fields
  if (!jsonContent.food) {
    throw new Error("Missing required field: food");
  }
  
  if (!jsonContent.nutritionInfo) {
    throw new Error("Missing required field: nutritionInfo");
  }
  
  // Ensure the nutritionInfo contains at least some basic fields
  const requiredNutrients = ["calories", "protein", "carbs"];
  const missingNutrients = requiredNutrients.filter(nutrient => 
    !jsonContent.nutritionInfo[nutrient]
  );
  
  if (missingNutrients.length > 0) {
    throw new Error(`Missing required nutrition info: ${missingNutrients.join(", ")}`);
  }

  return jsonContent;
}

/**
 * Executes a function with retry logic
 * @param {Function} fn - The async function to execute
 * @returns {Promise<any>} - Result of the function
 */
async function executeWithRetry(fn) {
  let lastError;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't delay on the last attempt
      if (attempt < MAX_RETRIES) {
        console.log(`Attempt ${attempt + 1} failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  
  throw lastError;
}