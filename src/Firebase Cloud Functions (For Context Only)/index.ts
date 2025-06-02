
/**
 * @fileOverview Firebase Cloud Functions for StockPilot.
 * This file contains the backend logic for user management,
 * specifically for creating new users by an admin.
 */

// Importaciones para Functions v2
import { https, logger } from "firebase-functions/v2";
import { CallableRequest } from "firebase-functions/v2/https"; // Importa CallableRequest de v2/https
import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK
// This should be done only once per Functions deployment.
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

interface CreateNewUserDataClientPayload {
  email: string;
  password?: string; // Password is required by createUser, but make optional if pre-verified by client
  displayName?: string;
  roleToAssign: "employee" | "admin" | "superadmin";
  assignedWarehouseIds?: string[]; // Changed from assignedWarehouseId to assignedWarehouseIds (array)
}

/**
 * Creates a new user in Firebase Authentication and their profile in Firestore.
 * This function must be called by an authenticated admin or superadmin.
 */
export const createNewUserByAdmin = https.onCall( // Usamos 'https' importado de v2
  async (request: CallableRequest<CreateNewUserDataClientPayload>) => { // La firma cambia: un solo argumento 'request'
    // 1. Authentication Check: Ensure the calling user is authenticated.
    // request.auth will be undefined if the user is not authenticated.
    if (!request.auth) {
      logger.error("Unauthenticated call to createNewUserByAdmin");
      throw new https.HttpsError( // Usamos 'https' importado de v2
        "unauthenticated",
        "The function must be called by an authenticated user."
      );
    }
    const adminUid = request.auth.uid; // Accedemos a auth desde request.auth

    // 2. Authorization Check: Ensure the calling user is an admin or superadmin.
    let adminRole: "employee" | "admin" | "superadmin" | null = null;
    try {
      const adminDoc = await db.collection("users").doc(adminUid).get();
      if (!adminDoc.exists || !adminDoc.data()?.isActive) {
        logger.warn(`Admin user ${adminUid} not found or is inactive.`);
        throw new https.HttpsError(
          "permission-denied",
          "Admin user not found or is inactive."
        );
      }
      adminRole = adminDoc.data()?.role as "employee" | "admin" | "superadmin" | null; // Type assertion
      if (!adminRole) {
        logger.error(`Admin user ${adminUid} does not have a role.`);
        throw new https.HttpsError(
          "internal",
          "Admin user role not found."
        );
      }
    } catch (error: any) {
      logger.error("Error fetching admin user role:", adminUid, error);
      if (error instanceof https.HttpsError) { // Re-throw HttpsError
        throw error;
      }
      throw new https.HttpsError(
        "internal",
        "Could not verify admin user role."
      );
    }

    if (adminRole !== "admin" && adminRole !== "superadmin") {
      logger.warn(`User ${adminUid} with role ${adminRole} attempted to create a user.`);
      throw new https.HttpsError(
        "permission-denied",
        "Caller does not have permission to create users."
      );
    }

    // 3. Input Validation (data is now request.data)
    const data = request.data; // Extraemos data del objeto request

    // Ensure data itself is not null or undefined, and has the expected properties
    if (!data || typeof data !== 'object') {
      throw new https.HttpsError(
        "invalid-argument",
        "Request data is missing or malformed."
      );
    }

    const { email, password, displayName, roleToAssign, assignedWarehouseIds } = data;

    if (!email || typeof email !== 'string') {
      throw new https.HttpsError(
        "invalid-argument",
        "Email is required and must be a string."
      );
    }
    if (!password || typeof password !== 'string') { // Password IS required to create user
      throw new https.HttpsError(
        "invalid-argument",
        "Password is required and must be a string."
      );
    }
    if (
      !roleToAssign ||
      !["employee", "admin", "superadmin"].includes(roleToAssign)
    ) {
      throw new https.HttpsError(
        "invalid-argument",
        "Invalid or missing role specified. Must be 'employee', 'admin', or 'superadmin'."
      );
    }
    if (displayName && typeof displayName !== 'string') {
        throw new https.HttpsError(
            "invalid-argument",
            "If provided, displayName must be a string."
          );
    }
    if (assignedWarehouseIds && (!Array.isArray(assignedWarehouseIds) || !assignedWarehouseIds.every(id => typeof id === 'string'))) {
        throw new https.HttpsError(
            "invalid-argument",
            "If provided, assignedWarehouseIds must be an array of strings."
        );
    }
    if (roleToAssign !== 'employee' && assignedWarehouseIds && assignedWarehouseIds.length > 0) {
        throw new https.HttpsError(
            "invalid-argument",
            "assignedWarehouseIds can only be set for users with the 'employee' role."
        );
    }


    // 4. Role Assignment Logic
    if (adminRole === "admin" && roleToAssign !== "employee") {
      logger.warn(`Admin ${adminUid} attempted to create user with role ${roleToAssign}.`);
      throw new https.HttpsError(
        "permission-denied",
        "Admins can only create users with the 'employee' role."
      );
    }
    if (adminRole === "superadmin" && roleToAssign === "superadmin") {
      logger.warn(
        `Superadmin ${adminUid} attempted to create another superadmin: ${email}. This action is currently restricted for safety.`
      );
       throw new https.HttpsError(
        "permission-denied",
        "Creating other superadmin users via this function is currently restricted. Please use Firebase Console or dedicated tools."
      );
    }


    // 5. Create User in Firebase Authentication
    let newUserRecord;
    try {
      newUserRecord = await admin.auth().createUser({
        email: email,
        password: password, // Password is always required by createUser
        displayName: displayName || email.split("@")[0],
        emailVerified: false, // Or true, depending on your flow
        disabled: false, // New users are active by default
      });
      logger.info("Successfully created new user in Auth:", newUserRecord.uid, "by admin:", adminUid);
    } catch (error: any) {
      logger.error("Error creating new user in Auth:", error.code, error.message, "Data:", {email, roleToAssign});
      let clientMessage = "Could not create user in Authentication.";
      if (error.code === "auth/email-already-exists") {
        clientMessage = "This email address is already in use.";
      } else if (error.code === "auth/invalid-password") {
        clientMessage = "The password must be a string with at least six characters.";
      } else if (error.code === "auth/invalid-email") {
        clientMessage = "The email address is not valid.";
      }
      throw new https.HttpsError("internal", clientMessage, error.code);
    }

    // 6. Create User Profile in Firestore
    const userProfile: { [key: string]: any } = { // Use a more flexible type for userProfile initially
      uid: newUserRecord.uid,
      email: newUserRecord.email, // Use email from newUserRecord as it's canonical
      displayName: newUserRecord.displayName, // Use displayName from newUserRecord
      role: roleToAssign,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
      createdBy: adminUid, // UID of the admin who created this user
    };

    if (roleToAssign === 'employee' && assignedWarehouseIds && assignedWarehouseIds.length > 0) {
      userProfile.assignedWarehouseIds = assignedWarehouseIds;
    }


    try {
      await db.collection("users").doc(newUserRecord.uid).set(userProfile);
      logger.info("User profile created in Firestore:", newUserRecord.uid);
    } catch (error: any) {
      logger.error(
        "Error creating user profile in Firestore for UID:",
        newUserRecord.uid,
        "Error:", error
      );
      logger.error(
        `CRITICAL: User ${newUserRecord.uid} created in Auth but FAILED Firestore profile creation. Manual cleanup may be required.`
      );
      throw new https.HttpsError(
        "internal",
        "User created in Authentication, but failed to create their profile in the database. Please contact support."
      );
    }

    // 7. Return success
    logger.info(`User ${newUserRecord.uid} (${email}) created successfully by ${adminUid} with role ${roleToAssign}.`);
    return {
      success: true,
      message: `User ${email} created successfully with role ${roleToAssign}.`,
      uid: newUserRecord.uid,
    };
  }
);
