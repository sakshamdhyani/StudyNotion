const User = require("../models/User");
const OTP = require("../models/OTP");
const otpGenerator = require("otp-generator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mainSender = require("../utils/mailSender");
const {passwordUpdated} = require("../mail/templates/passwordUpdate");
const Profile = require("../models/Profile");
require("dotenv").config();


// Send OTP
exports.sendotp = async (req, res) => {
    try {
      const { email } = req.body
  
      const checkUserPresent = await User.findOne({ email })

      if (checkUserPresent) {
        // Return 401 Unauthorized status code with error message
        return res.status(401).json({
          success: false,
          message: `User is Already Registered`,
        })
      }
  
      var otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      })

      const result = await OTP.findOne({ otp: otp })

      while (result) {
        var otp = otpGenerator.generate(6, {
            upperCaseAlphabets: false,
            lowerCaseAlphabets: false,
            specialChars: false,
        });

        result = await OTP.findOne({otp: otp});
      }

      const otpPayload = { email, otp }
      const otpBody = await OTP.create(otpPayload)

      res.status(200).json({
        success: true,
        message: `OTP Sent Successfully`,
        otp,
      });
    } 
    
    catch (error) {
        console.log(error.message)
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        })
    }
    
}

// Sign up
exports.signup = async (req , res) => {

    try{
        // Destructure fields from the request body
        const {
            firstName,
            lastName,
            email,
            password,
            confirmPassword,
            accountType,
            contactNumber,
            otp,
        } = req.body

        // Check if All Details are there or not
        if (
            !firstName ||
            !lastName ||
            !email ||
            !password ||
            !confirmPassword ||
            !otp
        ) {
            return res.status(403).send({
            success: false,
            message: "All Fields are required",
            })
        }

        // Check if password and confirm password match
        if (password !== confirmPassword) {
            return res.status(400).json({
            success: false,
            message:
                "Password and Confirm Password do not match. Please try again.",
            })
        }

         // Check if user already exists
        const existingUser = await User.findOne({ email })
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists. Please sign in to continue.",
            })
        }


        // Find the most recent OTP for the email
        const response = await OTP.find({ email }).sort({ createdAt: -1 }).limit(1)

        if (response.length === 0) {
        // OTP not found for the email
            return res.status(400).json({
                success: false,
                message: "The OTP is not valid",
            })
        } 
        else if (otp !== response[0].otp) {
        // Invalid OTP
            return res.status(400).json({
                success: false,
                message: "The OTP is not valid",
            })
        }

        
        // Hash password
        const hashedPassword = await bcrypt.hash(password , 10);

        // Create the Additional Profile For User
        const profileDetails = await Profile.create({
            gender: null,
            dateOfBirth: null,
            about: null,
            contactNumber: null,
        });

        const user = await User.create({
            firstName,
            lastName,
            email,
            contactNumber,
            password: hashedPassword,
            accountType,
            additionalDetails: profileDetails._id,
            image: `https://api.dicebear.com/5.x/initials/svg?seed=${firstName} ${lastName}`,
          })
      
          return res.status(200).json({
            success: true,
            user,
            message: "User registered successfully",
          })


    }
    catch(error){
        console.error(error)
        return res.status(500).json({
            success: false,
            message: "User cannot be registered. Please try again.",
        })
    }

}

// Login controller for authenticating users
exports.login = async (req, res) => {

    try {

      const { email, password } = req.body
  
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: `Please Fill up All the Required Fields`,
        })
      }
  
      // Find user with provided email
      const user = await User.findOne({ email }).populate("additionalDetails")
  
      if (!user) {
        return res.status(401).json({
          success: false,
          message: `User is not Registered with Us Please SignUp to Continue`,
        })
      }
  
      // Generate JWT token and Compare Password
      if (await bcrypt.compare(password, user.password)) {

        const token = jwt.sign({ 
            email: user.email, 
            id: user._id, 
            accountType: user.accountType 
            },

            process.env.JWT_SECRET,

            {
                expiresIn: "72h",
            }
        )
  
        // Save token to user document in database
        user.token = token
        user.password = undefined

        // Set cookie for token and return success response
        const options = {
          expires: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          httpOnly: true,
        }
        res.cookie("token", token, options).status(200).json({
          success: true,
          token,
          user,
          message: `User Login Success`,
        })

      } 

      else {
        return res.status(401).json({
          success: false,
          message: `Password is incorrect`,
        })
      }

    } 
    
    catch (error) {
      console.error(error)
      // Return 500 Internal Server Error status code with error message
      return res.status(500).json({
        success: false,
        message: `Login Failure Please Try Again`,
      })
    }
}

// Controller for Changing Password
exports.changePassword = async (req, res) => {
    try {

      const userDetails = await User.findById(req.user.id)
  
      const { oldPassword, newPassword } = req.body
  
      // Validate old password
      const isPasswordMatch = await bcrypt.compare(
        oldPassword,
        userDetails.password
      )
      
      if (!isPasswordMatch) {
        // If old password does not match, return a 401 (Unauthorized) error
        return res
          .status(401)
          .json({ success: false, message: "The password is incorrect" })
      }
  
      // Update password
      const encryptedPassword = await bcrypt.hash(newPassword, 10)
      const updatedUserDetails = await User.findByIdAndUpdate(
        req.user.id,
        { password: encryptedPassword },
        { new: true }
      )
  
      // Send notification email
      try {
        const emailResponse = await mailSender(
          updatedUserDetails.email,
          "Password for your account has been updated",
          passwordUpdated(
            updatedUserDetails.email,
            `Password updated successfully for ${updatedUserDetails.firstName} ${updatedUserDetails.lastName}`
          )
        )

      } 
      catch (error) {
        console.error("Error occurred while sending email:", error)
        return res.status(500).json({
          success: false,
          message: "Error occurred while sending email",
          error: error.message,
        })
      }
  
      // Return success response
      return res.status(200).json({ 
            success: true, 
            message: "Password updated successfully" 
        })

    } 
    
    catch (error) {

      console.error("Error occurred while updating password:", error)
      return res.status(500).json({
        success: false,
        message: "Error occurred while updating password",
        error: error.message,
      })
    }
}