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
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: "user_exists" } as RegisterActionState;
    }

    const locations = formData.get("locations") as string | null;
    await createUser(validatedData.email, validatedData.password, locations || undefined);

    const firstName = formData.get("firstName") as string | null;
    const lastName = formData.get("lastName") as string | null;
    const selectedTopics = formData.getAll("topics") as string[];
    const otherTopics = formData.get("otherTopics") as string | null;
    const readingLevel = formData.get("readingLevel") as string | null;

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

    const profilesDir = join(process.cwd(), "user-profiles");
    try {
      await mkdir(profilesDir, { recursive: true });
    } catch {
      // Directory might already exist, ignore error
    }

    const sanitizedEmail = validatedData.email.replace(/[^a-zA-Z0-9]/g, "_");
    const filePath = join(profilesDir, `${sanitizedEmail}.txt`);

    const fileContent = `User Profile Data
==================

First Name: ${profileData.firstName}
Last Name: ${profileData.lastName}
Topics: ${profileData.topics.join(", ")}
Reading Level: ${profileData.readingLevel}
Locations: ${profileData.locations}
Created At: ${profileData.createdAt}
`;

    await writeFile(filePath, fileContent, "utf-8");

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
