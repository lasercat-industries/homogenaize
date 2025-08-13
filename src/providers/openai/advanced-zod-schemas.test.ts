import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createOpenAILLM } from '../../client';

// Skip tests if no API key
const SKIP_TESTS = !process.env.OPENAI_API_KEY && !process.env.VITE_OPENAI_API_KEY;

describe.skipIf(SKIP_TESTS)('OpenAI Advanced Zod Schema Support', () => {
  const client = createOpenAILLM({
    apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  });

  describe('Discriminated Unions', () => {
    it('should handle basic discriminated union', async () => {
      const ResponseSchema = z.discriminatedUnion('type', [
        z.object({
          type: z.literal('success'),
          data: z.string(),
          timestamp: z.number(),
        }),
        z.object({
          type: z.literal('error'),
          message: z.string(),
          code: z.number(),
        }),
        z.object({
          type: z.literal('pending'),
          estimatedTime: z.number(),
          reason: z.string(),
        }),
      ]);

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Generate a success response with data "test completed" and current timestamp',
          },
        ],
        schema: ResponseSchema,
      });

      expect(response.content.type).toBe('success');
      if (response.content.type === 'success') {
        expect(response.content.data).toBe('test completed');
        expect(typeof response.content.timestamp).toBe('number');
      }
    });

    it('should handle discriminated union with nested objects', async () => {
      const PaymentSchema = z.discriminatedUnion('method', [
        z.object({
          method: z.literal('credit_card'),
          cardNumber: z.string(),
          cvv: z.string(),
          expiryDate: z.object({
            month: z.number().min(1).max(12),
            year: z.number().min(2024).max(2030),
          }),
        }),
        z.object({
          method: z.literal('paypal'),
          email: z.string().email(),
          verified: z.boolean(),
        }),
        z.object({
          method: z.literal('bank_transfer'),
          accountNumber: z.string(),
          routingNumber: z.string(),
          bankName: z.string(),
        }),
      ]);

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Generate a credit card payment with card number 4111111111111111, cvv 123, expiry 12/2025',
          },
        ],
        schema: PaymentSchema,
      });

      expect(response.content.method).toBe('credit_card');
      if (response.content.method === 'credit_card') {
        expect(response.content.cardNumber).toBe('4111111111111111');
        expect(response.content.cvv).toBe('123');
        expect(response.content.expiryDate.month).toBe(12);
        expect(response.content.expiryDate.year).toBe(2025);
      }
    });
  });

  describe('Recursive Schemas', () => {
    it('should handle recursive tree structure', async () => {
      type TreeNode = {
        value: string;
        children?: TreeNode[];
      };

      const TreeSchema: z.ZodType<TreeNode> = z.lazy(() =>
        z.object({
          value: z.string(),
          children: z.array(TreeSchema).optional(),
        }),
      );

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a tree with root "A", two children "B" and "C", where "B" has child "D"`,
          },
        ],
        schema: TreeSchema,
      });

      expect(response.content.value).toBe('A');
      expect(response.content.children).toHaveLength(2);
      expect(response.content.children?.[0].value).toBe('B');
      expect(response.content.children?.[0].children?.[0].value).toBe('D');
      expect(response.content.children?.[1].value).toBe('C');
    });

    it('should handle recursive comment thread', async () => {
      type Comment = {
        id: string;
        author: string;
        content: string;
        replies?: Comment[];
      };

      const CommentSchema: z.ZodType<Comment> = z.lazy(() =>
        z.object({
          id: z.string().uuid(),
          author: z.string(),
          content: z.string(),
          replies: z.array(CommentSchema).optional(),
        }),
      );

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a comment thread: main comment by Alice saying "Great post!", 
                     with a reply from Bob saying "I agree!", 
                     and Bob's comment has a reply from Charlie saying "Me too!"`,
          },
        ],
        schema: CommentSchema,
      });

      expect(response.content.author).toBe('Alice');
      expect(response.content.content).toBe('Great post!');
      expect(response.content.replies?.[0].author).toBe('Bob');
      expect(response.content.replies?.[0].replies?.[0].author).toBe('Charlie');
    });
  });

  describe('Complex Nested Objects', () => {
    it('should handle deeply nested object (4+ levels)', async () => {
      const CompanySchema = z.object({
        name: z.string(),
        headquarters: z.object({
          address: z.object({
            street: z.string(),
            city: z.string(),
            state: z.string(),
            country: z.string(),
            coordinates: z.object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            }),
          }),
          employees: z.number(),
          departments: z.array(
            z.object({
              name: z.string(),
              manager: z.object({
                name: z.string(),
                email: z.string().email(),
                reports: z.array(
                  z.object({
                    name: z.string(),
                    role: z.string(),
                  }),
                ),
              }),
            }),
          ),
        }),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a company "TechCorp" in San Francisco, CA, USA at coordinates 37.7749, -122.4194, 
                     with 500 employees, and an Engineering department managed by John Doe (john@techcorp.com) 
                     with 2 reports: Alice (Software Engineer) and Bob (DevOps Engineer)`,
          },
        ],
        schema: CompanySchema,
      });

      expect(response.content.name).toBe('TechCorp');
      expect(response.content.headquarters.address.city).toBe('San Francisco');
      expect(response.content.headquarters.address.coordinates.latitude).toBeCloseTo(37.7749, 2);
      expect(response.content.headquarters.departments[0].manager.reports).toHaveLength(2);
    });
  });

  describe('Zod Refinements and Transforms', () => {
    it('should handle custom refinements', async () => {
      const PasswordSchema = z
        .object({
          username: z.string().min(3).max(20),
          password: z
            .string()
            .min(8)
            .refine((val) => /[A-Z]/.test(val), 'Must contain uppercase letter')
            .refine((val) => /[a-z]/.test(val), 'Must contain lowercase letter')
            .refine((val) => /[0-9]/.test(val), 'Must contain number')
            .refine((val) => /[!@#$%^&*]/.test(val), 'Must contain special character'),
          confirmPassword: z.string(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: 'Passwords must match',
          path: ['confirmPassword'],
        });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create a user with username "john_doe" and a strong password "SecureP@ss123" (use same for confirm)',
          },
        ],
        schema: PasswordSchema,
      });

      expect(response.content.username).toBe('john_doe');
      expect(response.content.password).toBe('SecureP@ss123');
      expect(response.content.confirmPassword).toBe('SecureP@ss123');
    });

    it('should handle transforms', async () => {
      const TransformSchema = z.object({
        name: z.string().transform((val) => val.toUpperCase()),
        age: z.string().transform((val) => parseInt(val, 10)),
        tags: z.string().transform((val) => val.split(',').map((s) => s.trim())),
        isActive: z.string().transform((val) => val === 'true'),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with name "john", age "25", tags "developer, nodejs, react", isActive "true"',
          },
        ],
        schema: TransformSchema,
      });

      expect(response.content.name).toBe('JOHN');
      expect(response.content.age).toBe(25);
      expect(response.content.tags).toEqual(['developer', 'nodejs', 'react']);
      expect(response.content.isActive).toBe(true);
    });
  });

  describe('Arrays with Constraints', () => {
    it('should handle arrays with min/max length', async () => {
      const TeamSchema = z.object({
        teamName: z.string(),
        members: z
          .array(
            z.object({
              name: z.string(),
              role: z.enum(['leader', 'developer', 'designer', 'tester']),
            }),
          )
          .min(2)
          .max(5),
        projectTags: z.array(z.string()).length(3),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a team "Alpha Team" with 3 members: Alice (leader), Bob (developer), Charlie (designer).
                     Project tags should be exactly: "web", "mobile", "api"`,
          },
        ],
        schema: TeamSchema,
      });

      expect(response.content.teamName).toBe('Alpha Team');
      expect(response.content.members).toHaveLength(3);
      expect(response.content.projectTags).toHaveLength(3);
      expect(response.content.projectTags).toEqual(['web', 'mobile', 'api']);
    });

    it('should handle arrays with unique items', async () => {
      const UniqueSchema = z.object({
        ids: z.array(z.string().uuid()).min(3),
        numbers: z
          .array(z.number())
          .refine((items) => new Set(items).size === items.length, 'Numbers must be unique'),
        tags: z.set(z.string()),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with 3 unique UUIDs, unique numbers [1, 2, 3, 4, 5], and tags {"alpha", "beta", "gamma"}',
          },
        ],
        schema: UniqueSchema,
      });

      expect(response.content.ids.length).toBeGreaterThanOrEqual(3);
      expect(new Set(response.content.ids).size).toBe(response.content.ids.length);
      expect(response.content.numbers).toEqual([1, 2, 3, 4, 5]);
      expect(response.content.tags).toEqual(new Set(['alpha', 'beta', 'gamma']));
    });
  });

  describe('Record and Map Types', () => {
    it('should handle record types', async () => {
      const ConfigSchema = z.object({
        settings: z.record(z.string(), z.any()),
        features: z.record(z.enum(['basic', 'premium', 'enterprise']), z.boolean()),
        scores: z.record(z.string().regex(/^user_\d+$/), z.number().min(0).max(100)),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create config with:
                     settings: { theme: "dark", language: "en", notifications: true },
                     features: { basic: true, premium: true, enterprise: false },
                     scores: { user_1: 85, user_2: 92, user_3: 78 }`,
          },
        ],
        schema: ConfigSchema,
      });

      expect(response.content.settings.theme).toBe('dark');
      expect(response.content.features.basic).toBe(true);
      expect(response.content.features.enterprise).toBe(false);
      expect(response.content.scores.user_1).toBe(85);
    });

    it('should handle map types', async () => {
      const MapSchema = z.object({
        userRoles: z.map(z.string(), z.enum(['admin', 'user', 'guest'])),
        coordinates: z.map(
          z.string(),
          z.object({
            lat: z.number(),
            lng: z.number(),
          }),
        ),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
                     userRoles: Map with "alice" -> "admin", "bob" -> "user", "charlie" -> "guest"
                     coordinates: Map with "home" -> {lat: 37.7749, lng: -122.4194}, "work" -> {lat: 40.7128, lng: -74.0060}`,
          },
        ],
        schema: MapSchema,
      });

      expect(response.content.userRoles.get('alice')).toBe('admin');
      expect(response.content.coordinates.get('home')).toEqual({ lat: 37.7749, lng: -122.4194 });
    });
  });

  describe('Tuple Types', () => {
    it('should handle tuple types', async () => {
      const TupleSchema = z.object({
        coordinate: z.tuple([z.number(), z.number()]),
        rgb: z.tuple([
          z.number().min(0).max(255),
          z.number().min(0).max(255),
          z.number().min(0).max(255),
        ]),
        mixed: z.tuple([z.string(), z.number(), z.boolean()]),
        namedTuple: z.tuple([
          z.string().describe('firstName'),
          z.string().describe('lastName'),
          z.number().describe('age'),
        ]),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
                     coordinate: [10.5, 20.3],
                     rgb: [255, 128, 0],
                     mixed: ["test", 42, true],
                     namedTuple: ["John", "Doe", 30]`,
          },
        ],
        schema: TupleSchema,
      });

      expect(response.content.coordinate).toEqual([10.5, 20.3]);
      expect(response.content.rgb).toEqual([255, 128, 0]);
      expect(response.content.mixed).toEqual(['test', 42, true]);
      expect(response.content.namedTuple).toEqual(['John', 'Doe', 30]);
    });
  });

  describe('Union Types (Non-Discriminated)', () => {
    it('should handle union types', async () => {
      const UnionSchema = z.object({
        value: z.union([z.string(), z.number(), z.boolean()]),
        status: z.union([z.literal('active'), z.literal('inactive'), z.null()]),
        data: z.union([
          z.object({ type: z.literal('text'), content: z.string() }),
          z.object({ type: z.literal('number'), value: z.number() }),
          z.array(z.string()),
        ]),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
                     value: "hello",
                     status: "active",
                     data: { type: "text", content: "sample text" }`,
          },
        ],
        schema: UnionSchema,
      });

      expect(response.content.value).toBe('hello');
      expect(response.content.status).toBe('active');
      expect(response.content.data).toEqual({ type: 'text', content: 'sample text' });
    });
  });

  describe('Intersection Types', () => {
    it('should handle intersection types', async () => {
      const PersonSchema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const EmployeeSchema = z.object({
        employeeId: z.string(),
        department: z.string(),
      });

      const ManagerSchema = z.object({
        teamSize: z.number(),
        budget: z.number(),
      });

      const ManagerEmployeeSchema = PersonSchema.and(EmployeeSchema).and(ManagerSchema);

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a manager: name "Alice Smith", age 35, employeeId "EMP001", 
                     department "Engineering", teamSize 10, budget 500000`,
          },
        ],
        schema: ManagerEmployeeSchema,
      });

      expect(response.content.name).toBe('Alice Smith');
      expect(response.content.age).toBe(35);
      expect(response.content.employeeId).toBe('EMP001');
      expect(response.content.department).toBe('Engineering');
      expect(response.content.teamSize).toBe(10);
      expect(response.content.budget).toBe(500000);
    });
  });

  describe('Optional and Nullable Fields', () => {
    it('should handle optional and nullable fields', async () => {
      const ProfileSchema = z.object({
        username: z.string(),
        email: z.string().email(),
        bio: z.string().optional(),
        website: z.string().url().nullable(),
        age: z.number().optional(),
        preferences: z
          .object({
            theme: z.string(),
            notifications: z.boolean(),
          })
          .optional(),
        metadata: z.any().nullable(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a minimal profile with username "johndoe", email "john@example.com", 
                     and website null. Don't include optional fields.`,
          },
        ],
        schema: ProfileSchema,
      });

      expect(response.content.username).toBe('johndoe');
      expect(response.content.email).toBe('john@example.com');
      expect(response.content.website).toBeNull();
      expect(response.content.bio).toBeUndefined();
      expect(response.content.age).toBeUndefined();
    });
  });

  describe('Date and Time Schemas', () => {
    it('should handle date/time strings', async () => {
      const EventSchema = z.object({
        name: z.string(),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        createdAt: z.string().datetime({ offset: true }),
        time: z.string().time(),
        date: z.string().date(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create an event "Conference" starting at 2024-12-25T10:00:00Z, 
                     ending at 2024-12-25T18:00:00Z, created at 2024-11-01T09:00:00+00:00,
                     time "14:30:00", date "2024-12-25"`,
          },
        ],
        schema: EventSchema,
      });

      expect(response.content.name).toBe('Conference');
      expect(response.content.startDate).toBe('2024-12-25T10:00:00Z');
      expect(response.content.date).toBe('2024-12-25');
      expect(response.content.time).toBe('14:30:00');
    });

    it('should handle date transforms', async () => {
      const DateTransformSchema = z.object({
        timestamp: z.number().int().positive(),
        dateString: z.string().transform((str) => new Date(str)),
        isoDate: z
          .string()
          .datetime()
          .transform((str) => new Date(str)),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
                     timestamp: 1704067200 (Unix timestamp for Jan 1, 2024),
                     dateString: "2024-01-01",
                     isoDate: "2024-01-01T00:00:00Z"`,
          },
        ],
        schema: DateTransformSchema,
      });

      expect(response.content.timestamp).toBe(1704067200);
      expect(response.content.dateString).toBeInstanceOf(Date);
      expect(response.content.isoDate).toBeInstanceOf(Date);
    });
  });

  describe('Complex Regex Patterns', () => {
    it('should handle regex validations', async () => {
      const RegexSchema = z.object({
        phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/),
        zipCode: z.string().regex(/^\d{5}(-\d{4})?$/),
        ipAddress: z.string().regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/),
        hexColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        slug: z.string().regex(/^[a-z0-9-]+$/),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
                     phoneNumber: "+14155552671",
                     zipCode: "94102-1234",
                     ipAddress: "192.168.1.1",
                     hexColor: "#FF5733",
                     slug: "my-awesome-post"`,
          },
        ],
        schema: RegexSchema,
      });

      expect(response.content.phoneNumber).toBe('+14155552671');
      expect(response.content.zipCode).toBe('94102-1234');
      expect(response.content.ipAddress).toBe('192.168.1.1');
      expect(response.content.hexColor).toBe('#FF5733');
      expect(response.content.slug).toBe('my-awesome-post');
    });
  });

  describe('Large Complex Schemas', () => {
    it('should handle schema with 20+ fields', async () => {
      const LargeSchema = z.object({
        id: z.string().uuid(),
        name: z.string(),
        email: z.string().email(),
        age: z.number().int().positive(),
        isActive: z.boolean(),
        role: z.enum(['admin', 'user', 'guest']),
        permissions: z.array(z.string()),
        profile: z.object({
          bio: z.string(),
          avatar: z.string().url(),
          location: z.string(),
        }),
        settings: z.object({
          theme: z.string(),
          language: z.string(),
          notifications: z.boolean(),
        }),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        lastLogin: z.string().datetime().nullable(),
        metadata: z.record(z.string(), z.any()),
        tags: z.array(z.string()),
        score: z.number().min(0).max(100),
        level: z.number().int(),
        experience: z.number().int(),
        achievements: z.array(
          z.object({
            name: z.string(),
            date: z.string().date(),
          }),
        ),
        friends: z.array(z.string().uuid()),
        blockedUsers: z.array(z.string().uuid()),
        preferences: z.object({
          privacy: z.enum(['public', 'private', 'friends']),
          emailNotifications: z.boolean(),
          pushNotifications: z.boolean(),
        }),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a complete user object for "John Doe", john@example.com, age 28, admin role, 
                     active user with score 85, level 5, 1200 experience points. Include all required fields 
                     with reasonable values.`,
          },
        ],
        schema: LargeSchema,
      });

      expect(response.content.name).toBe('John Doe');
      expect(response.content.email).toBe('john@example.com');
      expect(response.content.age).toBe(28);
      expect(response.content.role).toBe('admin');
      expect(response.content.score).toBe(85);
      expect(response.content.level).toBe(5);
      expect(response.content.experience).toBe(1200);
    });
  });

  describe('Branded Types', () => {
    it('should handle branded types', async () => {
      const EmailBrand = z.string().email().brand('Email');
      const UserIdBrand = z.string().uuid().brand('UserId');
      const PositiveNumberBrand = z.number().positive().brand('PositiveNumber');

      const BrandedSchema = z.object({
        email: EmailBrand,
        userId: UserIdBrand,
        credits: PositiveNumberBrand,
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with email "test@example.com", a valid UUID for userId, and 100 credits`,
          },
        ],
        schema: BrandedSchema,
      });

      expect(response.content.email).toBe('test@example.com');
      expect(response.content.userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(response.content.credits).toBe(100);
    });
  });

  describe('Preprocessing and Coercion', () => {
    it('should handle preprocessed values', async () => {
      const PreprocessSchema = z.object({
        trimmedString: z.preprocess((val) => String(val).trim(), z.string()),
        normalizedEmail: z.preprocess(
          (val) => String(val).toLowerCase().trim(),
          z.string().email(),
        ),
        coercedNumber: z.coerce.number(),
        coercedBoolean: z.coerce.boolean(),
        coercedDate: z.coerce.date(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
                     trimmedString: "  hello world  ",
                     normalizedEmail: "  JOHN@EXAMPLE.COM  ",
                     coercedNumber: "42",
                     coercedBoolean: "true",
                     coercedDate: "2024-01-01"`,
          },
        ],
        schema: PreprocessSchema,
      });

      expect(response.content.trimmedString).toBe('hello world');
      expect(response.content.normalizedEmail).toBe('john@example.com');
      expect(response.content.coercedNumber).toBe(42);
      expect(response.content.coercedBoolean).toBe(true);
      expect(response.content.coercedDate).toBeInstanceOf(Date);
    });
  });

  describe('Default Values', () => {
    it('should handle default values', async () => {
      const DefaultSchema = z.object({
        name: z.string(),
        role: z.string().default('user'),
        score: z.number().default(0),
        settings: z
          .object({
            theme: z.string().default('light'),
            notifications: z.boolean().default(true),
          })
          .default({ theme: 'light', notifications: true }),
        tags: z.array(z.string()).default([]),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with only name "Alice" (let other fields use defaults)`,
          },
        ],
        schema: DefaultSchema,
      });

      expect(response.content.name).toBe('Alice');
      // Note: OpenAI might still provide values even when we want defaults
      // This tests whether the schema is accepted, not whether defaults work
    });
  });

  describe('Custom Error Messages', () => {
    it('should handle schemas with custom error messages', async () => {
      const CustomErrorSchema = z.object({
        username: z
          .string()
          .min(3, { message: 'Username must be at least 3 characters' })
          .max(20, { message: 'Username cannot exceed 20 characters' }),
        age: z
          .number()
          .int({ message: 'Age must be a whole number' })
          .min(18, { message: 'Must be at least 18 years old' })
          .max(120, { message: 'Age seems unrealistic' }),
        email: z.string().email({ message: 'Please provide a valid email address' }),
        password: z
          .string()
          .min(8, { message: 'Password must be at least 8 characters' })
          .regex(/[A-Z]/, { message: 'Password must contain an uppercase letter' })
          .regex(/[0-9]/, { message: 'Password must contain a number' }),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with username "johndoe", age 25, email "john@example.com", password "SecurePass123"`,
          },
        ],
        schema: CustomErrorSchema,
      });

      expect(response.content.username).toBe('johndoe');
      expect(response.content.age).toBe(25);
      expect(response.content.email).toBe('john@example.com');
      expect(response.content.password).toBe('SecurePass123');
    });
  });

  describe('Catch and CatchAll', () => {
    it('should handle catch and catchall', async () => {
      const CatchSchema = z.object({
        name: z.string(),
        value: z.number().catch(0), // Falls back to 0 on error
        data: z.string().catch('default'),
      });

      const CatchAllSchema = z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .catchall(z.any()); // Allows additional properties

      const response1 = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with name "Test", value 42, data "hello"`,
          },
        ],
        schema: CatchSchema,
      });

      expect(response1.content.name).toBe('Test');
      expect(response1.content.value).toBe(42);
      expect(response1.content.data).toBe('hello');

      const response2 = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with id "123", name "Test", and additional fields: extra1 "value1", extra2 42`,
          },
        ],
        schema: CatchAllSchema,
      });

      expect(response2.content.id).toBe('123');
      expect(response2.content.name).toBe('Test');
      expect(response2.content.extra1).toBe('value1');
      expect(response2.content.extra2).toBe(42);
    });
  });

  describe('Pipelines and Compositions', () => {
    it('should handle pipe compositions', async () => {
      const PipelineSchema = z
        .string()
        .min(3)
        .max(20)
        .trim()
        .toLowerCase()
        .transform((val) => val.replace(/\s+/g, '-'))
        .pipe(z.string().regex(/^[a-z-]+$/));

      const ComposedSchema = z.object({
        slug: PipelineSchema,
        tags: z
          .array(z.string())
          .transform((arr) => arr.map((s) => s.toLowerCase()))
          .pipe(z.array(z.string().min(2))),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with slug "Hello World Test" and tags ["React", "TypeScript", "Node"]`,
          },
        ],
        schema: ComposedSchema,
      });

      expect(response.content.slug).toBe('hello-world-test');
      expect(response.content.tags).toEqual(['react', 'typescript', 'node']);
    });
  });
});
