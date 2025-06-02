
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User } from "@/types";

/**
 * Fetches a user document from Firestore by their ID.
 * @param userId The ID of the user to fetch.
 * @returns The user object if found, otherwise null.
 */
export const getUserById = async (userId: string): Promise<User | null> => {
  if (!userId) return null;
  const userDocRef = doc(db, "users", userId);
  try {
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      // Ensure the 'id' field is included, as it's often the Firestore document ID
      // and might not be explicitly stored in the document data itself if uid is used as doc id.
      // However, our User type expects 'id', which should match the Firestore document ID (user.uid).
      return { id: docSnap.id, ...docSnap.data() } as User;
    } else {
      console.warn(`No user found with ID: ${userId}`);
      return null;
    }
  } catch (error) {
    console.error("Error fetching user by ID:", error);
    return null;
  }
};
