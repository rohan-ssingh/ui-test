"use server";

import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

import { createUser, getUser } from "@/lib/db/queries";

import { signIn } from "./auth";

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  console.log("🚀 Register function called!");
  console.log("📋 Form data received:");
  
  // Log all form data entries
  const formEntries: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (formEntries[key]) {
      // Handle multiple values (like topics)
      if (Array.isArray(formEntries[key])) {
        (formEntries[key] as string[]).push(value as string);
      } else {
        formEntries[key] = [formEntries[key] as string, value as string];
      }
    } else {
      formEntries[key] = value as string;
    }
  }
  console.log("📋 Form entries:", formEntries);
  
  try {
    // Email and password validation and database logic - UNCHANGED
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    console.log("✅ Email/password validated:", validatedData.email);

    const [user] = await getUser(validatedData.email);

    if (user) {
      console.log("⚠️ User already exists:", validatedData.email);
      return { status: "user_exists" } as RegisterActionState;
    }
    console.log("👤 Creating user in database...");
    await createUser(validatedData.email, validatedData.password);
    console.log("✅ User created in database");

    // Save profile data to .txt file (NOT email/password)
    const firstName = formData.get("firstName") as string | null;
    const lastName = formData.get("lastName") as string | null;
    const selectedTopics = formData.getAll("topics") as string[];
    const otherTopics = formData.get("otherTopics") as string | null;
    const readingLevel = formData.get("readingLevel") as string | null;
    const locations = formData.get("locations") as string | null;

    // Print reading level to console
    console.log("Reading Level (in-depth answer):", readingLevel);

    const isOtherSelected = selectedTopics.includes("other");
    const allTopics = isOtherSelected && otherTopics
      ? [...selectedTopics.filter((t) => t !== "other"), otherTopics.trim()]
      : selectedTopics;

    const profileData = {
      firstName: firstName || "",
      lastName: lastName || "",
      topics: allTopics,
      readingLevel: readingLevel || "",
      locations: locations || "",
      createdAt: new Date().toISOString(),
    };

    // Create user-profiles directory if it doesn't exist
    const profilesDir = join(process.cwd(), "user-profiles");
    console.log("📁 Profile directory path:", profilesDir);
    
    try {
      await mkdir(profilesDir, { recursive: true });
      console.log("✅ Directory created/verified:", profilesDir);
    } catch (error) {
      // Directory might already exist, ignore error
      console.log("⚠️ Directory might already exist:", error);
    }

    // Create filename from email (sanitize for filesystem)
    const sanitizedEmail = validatedData.email.replace(/[^a-zA-Z0-9]/g, "_");
    const filePath = join(profilesDir, `${sanitizedEmail}.txt`);
    console.log("📄 Full file path:", filePath);
    console.log("📧 User email:", validatedData.email);
    console.log("🔤 Sanitized email:", sanitizedEmail);

    // Format the data for the text file (NO email/password)
    const fileContent = `User Profile Data
==================

First Name: ${profileData.firstName}
Last Name: ${profileData.lastName}
Topics: ${profileData.topics.join(", ")}
Reading Level: ${profileData.readingLevel}
Locations: ${profileData.locations}
Created At: ${profileData.createdAt}
`;

    console.log("💾 Saving profile data...");
    console.log("📝 Profile data:", {
      firstName: profileData.firstName,
      lastName: profileData.lastName,
      topics: profileData.topics,
      readingLevel: profileData.readingLevel,
      locations: profileData.locations,
    });

    try {
      await writeFile(filePath, fileContent, "utf-8");
      console.log("✅ Profile data successfully saved to:", filePath);
    } catch (error) {
      console.error("❌ Error saving profile data:", error);
      throw error;
    }

    // Sign in logic - UNCHANGED
    console.log("🔐 Signing in user...");
    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });
    console.log("✅ User signed in");

    console.log("🎉 Registration completed successfully!");
    return { status: "success" };
  } catch (error) {
    console.error("❌ Registration error:", error);
    if (error instanceof z.ZodError) {
      console.error("❌ Validation error:", error.errors);
      return { status: "invalid_data" };
    }

    console.error("❌ Registration failed with error:", error);
    return { status: "failed" };
  }
};
