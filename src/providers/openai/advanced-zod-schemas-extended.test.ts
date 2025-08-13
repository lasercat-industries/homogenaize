import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createOpenAILLM } from '../../client';

// Skip tests if no API key
const SKIP_TESTS = !process.env.OPENAI_API_KEY && !process.env.VITE_OPENAI_API_KEY;

describe.skipIf(SKIP_TESTS)('OpenAI Extended Zod Schema Support', () => {
  const client = createOpenAILLM({
    apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  });

  describe('Enum Variations', () => {
    it('should handle native enums', async () => {
      enum Status {
        Active = 'ACTIVE',
        Inactive = 'INACTIVE',
        Pending = 'PENDING',
      }

      const NativeEnumSchema = z.object({
        status: z.nativeEnum(Status),
        priority: z.enum(['low', 'medium', 'high']),
        category: z.enum(['A', 'B', 'C'] as const),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with status ACTIVE, priority high, category A',
          },
        ],
        schema: NativeEnumSchema,
      });

      expect(response.content.status).toBe(Status.Active);
      expect(response.content.priority).toBe('high');
      expect(response.content.category).toBe('A');
    });

    it('should handle numeric enums', async () => {
      enum Level {
        Beginner = 1,
        Intermediate = 2,
        Advanced = 3,
        Expert = 4,
      }

      const NumericEnumSchema = z.object({
        userLevel: z.nativeEnum(Level),
        score: z.number().int().min(0).max(100),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with userLevel 3 (Advanced) and score 85',
          },
        ],
        schema: NumericEnumSchema,
      });

      expect(response.content.userLevel).toBe(Level.Advanced);
      expect(response.content.score).toBe(85);
    });
  });

  describe('Complex Union Scenarios', () => {
    it('should handle mixed type unions with refinements', async () => {
      const MixedUnionSchema = z.object({
        data: z.union([
          z.string().min(5),
          z.number().positive(),
          z.array(z.string()).min(2),
          z.object({ id: z.string(), value: z.number() }),
        ]),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with data as array ["item1", "item2", "item3"]',
          },
        ],
        schema: MixedUnionSchema,
      });

      expect(Array.isArray(response.content.data)).toBe(true);
      expect(response.content.data).toEqual(['item1', 'item2', 'item3']);
    });

    it('should handle nullable unions', async () => {
      const NullableUnionSchema = z.object({
        value: z.union([z.string(), z.number(), z.null()]),
        optional: z.union([z.string(), z.undefined()]),
        mixed: z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with value null, optional undefined, mixed "test"',
          },
        ],
        schema: NullableUnionSchema,
      });

      expect(response.content.value).toBeNull();
      expect(response.content.optional).toBeUndefined();
      expect(response.content.mixed).toBe('test');
    });
  });

  describe('Literal Types and Constants', () => {
    it('should handle literal values', async () => {
      const LiteralSchema = z.object({
        version: z.literal('1.0.0'),
        type: z.literal('user'),
        count: z.literal(42),
        active: z.literal(true),
        config: z.literal(null),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with exact literal values: version 1.0.0, type user, count 42, active true, config null',
          },
        ],
        schema: LiteralSchema,
      });

      expect(response.content.version).toBe('1.0.0');
      expect(response.content.type).toBe('user');
      expect(response.content.count).toBe(42);
      expect(response.content.active).toBe(true);
      expect(response.content.config).toBeNull();
    });

    it('should handle const values', async () => {
      const CONSTANTS = {
        MAX_LENGTH: 100,
        MIN_LENGTH: 10,
        DEFAULT_ROLE: 'user',
      } as const;

      const ConstSchema = z.object({
        role: z.literal(CONSTANTS.DEFAULT_ROLE),
        maxLength: z.literal(CONSTANTS.MAX_LENGTH),
        minLength: z.literal(CONSTANTS.MIN_LENGTH),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with role "${CONSTANTS.DEFAULT_ROLE}", maxLength ${CONSTANTS.MAX_LENGTH}, minLength ${CONSTANTS.MIN_LENGTH}`,
          },
        ],
        schema: ConstSchema,
      });

      expect(response.content.role).toBe(CONSTANTS.DEFAULT_ROLE);
      expect(response.content.maxLength).toBe(CONSTANTS.MAX_LENGTH);
    });
  });

  describe('String Validations', () => {
    it('should handle various string formats', async () => {
      const StringFormatsSchema = z.object({
        email: z.string().email(),
        url: z.string().url(),
        uuid: z.string().uuid(),
        cuid: z.string().cuid(),
        cuid2: z.string().cuid2(),
        ulid: z.string().ulid(),
        ip: z.string().ip(),
        ipv4: z.string().ip({ version: 'v4' }),
        ipv6: z.string().ip({ version: 'v6' }),
        emoji: z.string().emoji(),
        nanoid: z.string().nanoid(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
              email: test@example.com,
              url: https://example.com,
              uuid: 550e8400-e29b-41d4-a716-446655440000,
              cuid: clh1z4fn10000356tq9z8x2z9,
              cuid2: clh1z4fn10000356tq9z8x2z9x,
              ulid: 01ARZ3NDEKTSV4RRFFQ69G5FAV,
              ip: 192.168.1.1,
              ipv4: 10.0.0.1,
              ipv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334,
              emoji: 😀,
              nanoid: V1StGXR8_Z5jdHi6B-myT`,
          },
        ],
        schema: StringFormatsSchema,
      });

      expect(response.content.email).toBe('test@example.com');
      expect(response.content.url).toBe('https://example.com');
      expect(response.content.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should handle string length constraints', async () => {
      const StringLengthSchema = z.object({
        exact: z.string().length(5),
        min: z.string().min(3),
        max: z.string().max(10),
        range: z.string().min(5).max(10),
        trimmed: z.string().trim(),
        lowercase: z.string().toLowerCase(),
        uppercase: z.string().toUpperCase(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
              exact: "hello" (exactly 5 chars),
              min: "test",
              max: "short",
              range: "medium",
              trimmed: "  trim me  ",
              lowercase: "LOWER",
              uppercase: "upper"`,
          },
        ],
        schema: StringLengthSchema,
      });

      expect(response.content.exact).toBe('hello');
      expect(response.content.exact.length).toBe(5);
      expect(response.content.lowercase).toBe('lower');
      expect(response.content.uppercase).toBe('UPPER');
    });
  });

  describe('Number Validations', () => {
    it('should handle number constraints', async () => {
      const NumberSchema = z.object({
        int: z.number().int(),
        positive: z.number().positive(),
        negative: z.number().negative(),
        nonpositive: z.number().nonpositive(),
        nonnegative: z.number().nonnegative(),
        multipleOf: z.number().multipleOf(5),
        finite: z.number().finite(),
        safe: z.number().safe(),
        gt: z.number().gt(10),
        gte: z.number().gte(10),
        lt: z.number().lt(100),
        lte: z.number().lte(100),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
              int: 42,
              positive: 10,
              negative: -5,
              nonpositive: 0,
              nonnegative: 0,
              multipleOf: 15,
              finite: 100,
              safe: 1000,
              gt: 11,
              gte: 10,
              lt: 99,
              lte: 100`,
          },
        ],
        schema: NumberSchema,
      });

      expect(response.content.int).toBe(42);
      expect(response.content.positive).toBe(10);
      expect(response.content.negative).toBe(-5);
      expect(response.content.multipleOf).toBe(15);
      expect(response.content.multipleOf % 5).toBe(0);
    });

    it('should handle BigInt', async () => {
      const BigIntSchema = z.object({
        bigNumber: z.bigint(),
        positiveBigInt: z.bigint().positive(),
        maxBigInt: z.bigint().max(BigInt(1000000)),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with bigNumber: 9007199254740992, positiveBigInt: 123456789, maxBigInt: 999999',
          },
        ],
        schema: BigIntSchema,
      });

      expect(typeof response.content.bigNumber).toBe('bigint');
      expect(response.content.positiveBigInt > 0n).toBe(true);
    });
  });

  describe('Object Manipulations', () => {
    it('should handle strict objects', async () => {
      const StrictSchema = z.strictObject({
        name: z.string(),
        age: z.number(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with name "John" and age 30 (no extra fields)',
          },
        ],
        schema: StrictSchema,
      });

      expect(response.content.name).toBe('John');
      expect(response.content.age).toBe(30);
      expect(Object.keys(response.content).length).toBe(2);
    });

    it('should handle passthrough objects', async () => {
      const PassthroughSchema = z
        .object({
          required: z.string(),
          number: z.number(),
        })
        .passthrough();

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with required: "test", number: 42, extra: "allowed", another: true',
          },
        ],
        schema: PassthroughSchema,
      });

      expect(response.content.required).toBe('test');
      expect(response.content.number).toBe(42);
      // Passthrough should allow extra fields
      expect(response.content.extra).toBe('allowed');
      expect(response.content.another).toBe(true);
    });

    it('should handle partial objects', async () => {
      const BaseSchema = z.object({
        name: z.string(),
        age: z.number(),
        email: z.string().email(),
      });

      const PartialSchema = BaseSchema.partial();

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with only name "Alice" (other fields optional)',
          },
        ],
        schema: PartialSchema,
      });

      expect(response.content.name).toBe('Alice');
      // Other fields should be optional
    });

    it('should handle required objects', async () => {
      const OptionalSchema = z.object({
        name: z.string().optional(),
        age: z.number().optional(),
        email: z.string().email().optional(),
      });

      const RequiredSchema = OptionalSchema.required();

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with name "Bob", age 25, email "bob@example.com" (all required)',
          },
        ],
        schema: RequiredSchema,
      });

      expect(response.content.name).toBe('Bob');
      expect(response.content.age).toBe(25);
      expect(response.content.email).toBe('bob@example.com');
    });

    it('should handle pick and omit', async () => {
      const FullSchema = z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
        email: z.string().email(),
        password: z.string(),
      });

      const PickedSchema = FullSchema.pick({ name: true, email: true });
      const OmittedSchema = FullSchema.omit({ password: true });

      const response1 = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with name "Carol" and email "carol@example.com"',
          },
        ],
        schema: PickedSchema,
      });

      expect(response1.content.name).toBe('Carol');
      expect(response1.content.email).toBe('carol@example.com');
      expect(response1.content.password).toBeUndefined();

      const response2 = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with id "123", name "Dave", age 35, email "dave@example.com"',
          },
        ],
        schema: OmittedSchema,
      });

      expect(response2.content.id).toBe('123');
      expect(response2.content.password).toBeUndefined();
    });

    it('should handle deep partial', async () => {
      const NestedSchema = z.object({
        user: z.object({
          name: z.string(),
          profile: z.object({
            bio: z.string(),
            location: z.object({
              city: z.string(),
              country: z.string(),
            }),
          }),
        }),
      });

      const DeepPartialSchema = NestedSchema.deepPartial();

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with only user.name "Eve" and user.profile.location.city "NYC"',
          },
        ],
        schema: DeepPartialSchema,
      });

      expect(response.content.user?.name).toBe('Eve');
      expect(response.content.user?.profile?.location?.city).toBe('NYC');
    });

    it('should handle merge', async () => {
      const Schema1 = z.object({
        name: z.string(),
        age: z.number(),
      });

      const Schema2 = z.object({
        email: z.string().email(),
        role: z.string(),
      });

      const MergedSchema = Schema1.merge(Schema2);

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with name "Frank", age 40, email "frank@example.com", role "admin"',
          },
        ],
        schema: MergedSchema,
      });

      expect(response.content.name).toBe('Frank');
      expect(response.content.age).toBe(40);
      expect(response.content.email).toBe('frank@example.com');
      expect(response.content.role).toBe('admin');
    });

    it('should handle extend', async () => {
      const BaseSchema = z.object({
        name: z.string(),
        type: z.literal('base'),
      });

      const ExtendedSchema = BaseSchema.extend({
        age: z.number(),
        email: z.string().email(),
        type: z.literal('extended'), // Override base field
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with name "Grace", age 28, email "grace@example.com", type "extended"',
          },
        ],
        schema: ExtendedSchema,
      });

      expect(response.content.name).toBe('Grace');
      expect(response.content.type).toBe('extended');
    });
  });

  describe('Array Manipulations', () => {
    it('should handle nonempty arrays', async () => {
      const NonemptySchema = z.object({
        items: z.array(z.string()).nonempty(),
        numbers: z.array(z.number()).nonempty({ message: "Can't be empty!" }),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with items ["a", "b"] and numbers [1, 2, 3]',
          },
        ],
        schema: NonemptySchema,
      });

      expect(response.content.items.length).toBeGreaterThan(0);
      expect(response.content.numbers.length).toBeGreaterThan(0);
    });

    it('should handle array element access', async () => {
      const ArraySchema = z.object({
        tuple: z.tuple([z.string(), z.number(), z.boolean()]).rest(z.string()),
        fixedLength: z.array(z.number()).length(5),
        minMax: z.array(z.string()).min(2).max(5),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
              tuple: ["first", 42, true, "rest1", "rest2"],
              fixedLength: [1, 2, 3, 4, 5],
              minMax: ["a", "b", "c"]`,
          },
        ],
        schema: ArraySchema,
      });

      expect(response.content.fixedLength).toHaveLength(5);
      expect(response.content.minMax.length).toBeGreaterThanOrEqual(2);
      expect(response.content.minMax.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Async Refinements', () => {
    it('should handle superRefine', async () => {
      const SuperRefineSchema = z
        .object({
          password: z.string(),
          confirmPassword: z.string(),
        })
        .superRefine((data, ctx) => {
          if (data.password !== data.confirmPassword) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Passwords don't match",
              path: ['confirmPassword'],
            });
          }
          if (data.password.length < 8) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Password too short',
              path: ['password'],
            });
          }
        });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Create object with password "SecurePass123" and confirmPassword "SecurePass123"',
          },
        ],
        schema: SuperRefineSchema,
      });

      expect(response.content.password).toBe('SecurePass123');
      expect(response.content.confirmPassword).toBe('SecurePass123');
    });
  });

  describe('Complex Real-World Schemas', () => {
    it('should handle e-commerce order schema', async () => {
      const AddressSchema = z.object({
        street: z.string(),
        city: z.string(),
        state: z.string().length(2),
        zipCode: z.string().regex(/^\d{5}(-\d{4})?$/),
        country: z.string().default('US'),
      });

      const OrderItemSchema = z.object({
        productId: z.string().uuid(),
        name: z.string(),
        quantity: z.number().int().positive(),
        price: z.number().positive(),
        discount: z.number().min(0).max(1).optional(),
      });

      const OrderSchema = z.object({
        orderId: z.string().uuid(),
        customerId: z.string().uuid(),
        orderDate: z.string().datetime(),
        status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
        items: z.array(OrderItemSchema).nonempty(),
        shippingAddress: AddressSchema,
        billingAddress: AddressSchema,
        subtotal: z.number().positive(),
        tax: z.number().nonnegative(),
        shipping: z.number().nonnegative(),
        total: z.number().positive(),
        paymentMethod: z.discriminatedUnion('type', [
          z.object({
            type: z.literal('credit_card'),
            last4: z.string().length(4),
            brand: z.enum(['visa', 'mastercard', 'amex', 'discover']),
          }),
          z.object({
            type: z.literal('paypal'),
            email: z.string().email(),
          }),
        ]),
        notes: z.string().optional(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create an e-commerce order with:
              - Order ID and Customer ID (valid UUIDs)
              - Order date: 2024-01-15T10:30:00Z
              - Status: processing
              - 2 items: Widget ($29.99, qty 2) and Gadget ($49.99, qty 1)
              - Shipping to: 123 Main St, New York, NY 10001
              - Billing same as shipping
              - Payment: Visa ending in 1234
              - Calculate appropriate totals`,
          },
        ],
        schema: OrderSchema,
      });

      expect(response.content.status).toBe('processing');
      expect(response.content.items).toHaveLength(2);
      expect(response.content.paymentMethod.type).toBe('credit_card');
      if (response.content.paymentMethod.type === 'credit_card') {
        expect(response.content.paymentMethod.last4).toBe('1234');
        expect(response.content.paymentMethod.brand).toBe('visa');
      }
    });

    it('should handle blog post with comments schema', async () => {
      const AuthorSchema = z.object({
        id: z.string().uuid(),
        name: z.string(),
        email: z.string().email(),
        avatar: z.string().url().optional(),
        bio: z.string().max(500).optional(),
      });

      const CommentSchema = z.object({
        id: z.string().uuid(),
        author: AuthorSchema,
        content: z.string().min(1).max(1000),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime().optional(),
        likes: z.number().int().nonnegative().default(0),
        replies: z.array(z.lazy(() => CommentSchema)).optional(),
      });

      const BlogPostSchema = z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200),
        slug: z.string().regex(/^[a-z0-9-]+$/),
        content: z.string().min(100),
        excerpt: z.string().max(300),
        author: AuthorSchema,
        publishedAt: z.string().datetime(),
        updatedAt: z.string().datetime().optional(),
        status: z.enum(['draft', 'published', 'archived']),
        tags: z.array(z.string()).min(1).max(10),
        categories: z.array(z.string()).min(1).max(5),
        featuredImage: z.string().url().optional(),
        seo: z
          .object({
            metaTitle: z.string().max(60).optional(),
            metaDescription: z.string().max(160).optional(),
            keywords: z.array(z.string()).max(10).optional(),
          })
          .optional(),
        comments: z.array(CommentSchema),
        commentCount: z.number().int().nonnegative(),
        viewCount: z.number().int().nonnegative().default(0),
        likes: z.number().int().nonnegative().default(0),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a blog post about "Introduction to TypeScript" with:
              - Title: "Getting Started with TypeScript"
              - Slug: "getting-started-with-typescript"
              - Author: John Doe (john@example.com)
              - Published today
              - Status: published
              - Tags: ["typescript", "javascript", "programming"]
              - Categories: ["tutorials"]
              - 2 comments from different authors
              - SEO metadata
              - At least 100 chars of content`,
          },
        ],
        schema: BlogPostSchema,
      });

      expect(response.content.title).toBe('Getting Started with TypeScript');
      expect(response.content.slug).toBe('getting-started-with-typescript');
      expect(response.content.status).toBe('published');
      expect(response.content.tags).toContain('typescript');
      expect(response.content.comments).toHaveLength(2);
    });

    it('should handle API response wrapper schema', async () => {
      const PaginationSchema = z.object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive().max(100),
        totalPages: z.number().int().nonnegative(),
        totalItems: z.number().int().nonnegative(),
        hasNext: z.boolean(),
        hasPrevious: z.boolean(),
      });

      const ErrorSchema = z.object({
        code: z.string(),
        message: z.string(),
        field: z.string().optional(),
        details: z.record(z.string(), z.any()).optional(),
      });

      const ApiResponseSchema = z.object({
        success: z.boolean(),
        data: z.any().optional(),
        errors: z.array(ErrorSchema).optional(),
        warnings: z.array(z.string()).optional(),
        metadata: z.object({
          requestId: z.string().uuid(),
          timestamp: z.string().datetime(),
          version: z.string(),
          duration: z.number().positive(),
        }),
        pagination: PaginationSchema.optional(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a successful API response with:
              - Data: array of 3 user objects
              - Pagination: page 1 of 5, 10 items per page, 50 total
              - Request ID (UUID), current timestamp, version 1.0.0, duration 125ms`,
          },
        ],
        schema: ApiResponseSchema,
      });

      expect(response.content.success).toBe(true);
      expect(response.content.metadata.version).toBe('1.0.0');
      expect(response.content.pagination?.page).toBe(1);
      expect(response.content.pagination?.totalPages).toBe(5);
    });
  });

  describe('Edge Cases and Gotchas', () => {
    it('should handle empty objects and arrays', async () => {
      const EmptySchema = z.object({
        emptyObject: z.object({}),
        emptyArray: z.array(z.any()).length(0),
        objectWithDefaults: z.object({}).catchall(z.string()),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'Create object with emptyObject: {}, emptyArray: [], objectWithDefaults: {}',
          },
        ],
        schema: EmptySchema,
      });

      expect(response.content.emptyObject).toEqual({});
      expect(response.content.emptyArray).toEqual([]);
    });

    it('should handle circular references with lazy', async () => {
      type Category = {
        name: string;
        parent?: Category;
        children?: Category[];
      };

      const CategorySchema: z.ZodType<Category> = z.lazy(() =>
        z.object({
          name: z.string(),
          parent: CategorySchema.optional(),
          children: z.array(CategorySchema).optional(),
        }),
      );

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create a category "Electronics" with parent "Products" and child "Phones"`,
          },
        ],
        schema: CategorySchema,
      });

      expect(response.content.name).toBe('Electronics');
      expect(response.content.parent?.name).toBe('Products');
      expect(response.content.children?.[0]?.name).toBe('Phones');
    });

    it('should handle very long strings', async () => {
      const LongStringSchema = z.object({
        shortDesc: z.string().max(100),
        mediumDesc: z.string().min(100).max(500),
        longDesc: z.string().min(500).max(2000),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
              - shortDesc: "Brief description" (under 100 chars)
              - mediumDesc: 150 character description about a product
              - longDesc: 600 character detailed description`,
          },
        ],
        schema: LongStringSchema,
      });

      expect(response.content.shortDesc.length).toBeLessThanOrEqual(100);
      expect(response.content.mediumDesc.length).toBeGreaterThanOrEqual(100);
      expect(response.content.mediumDesc.length).toBeLessThanOrEqual(500);
      expect(response.content.longDesc.length).toBeGreaterThanOrEqual(500);
    });

    it('should handle all primitive types', async () => {
      const PrimitivesSchema = z.object({
        string: z.string(),
        number: z.number(),
        boolean: z.boolean(),
        null: z.null(),
        undefined: z.undefined(),
        void: z.void(),
        any: z.any(),
        unknown: z.unknown(),
        never: z.never().optional(), // Never type must be optional
        symbol: z.symbol().optional(), // Symbol might not serialize well
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with string: "test", number: 42, boolean: true, null: null, undefined: undefined, any: "anything", unknown: {"nested": true}`,
          },
        ],
        schema: PrimitivesSchema,
      });

      expect(response.content.string).toBe('test');
      expect(response.content.number).toBe(42);
      expect(response.content.boolean).toBe(true);
      expect(response.content.null).toBeNull();
    });

    it('should handle deeply nested arrays', async () => {
      const NestedArraySchema = z.object({
        matrix2D: z.array(z.array(z.number())),
        matrix3D: z.array(z.array(z.array(z.number()))),
        mixed: z.array(z.union([z.string(), z.array(z.string()), z.array(z.array(z.string()))])),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create object with:
              - matrix2D: [[1,2], [3,4]]
              - matrix3D: [[[1,2], [3,4]], [[5,6], [7,8]]]
              - mixed: ["flat", ["nested"], [["deep", "nested"]]]`,
          },
        ],
        schema: NestedArraySchema,
      });

      expect(response.content.matrix2D).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(response.content.matrix3D[0][0]).toEqual([1, 2]);
    });
  });

  describe('Schema Composition Patterns', () => {
    it('should handle schema factories', async () => {
      const createUserSchema = (role: 'admin' | 'user') => {
        const base = z.object({
          id: z.string().uuid(),
          name: z.string(),
          email: z.string().email(),
        });

        if (role === 'admin') {
          return base.extend({
            role: z.literal('admin'),
            permissions: z.array(z.string()),
            canDelete: z.boolean(),
          });
        }

        return base.extend({
          role: z.literal('user'),
          subscription: z.enum(['free', 'premium']),
        });
      };

      const AdminSchema = createUserSchema('admin');

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create admin user: name "Admin Joe", email "admin@example.com", permissions ["read", "write", "delete"], canDelete true`,
          },
        ],
        schema: AdminSchema,
      });

      expect(response.content.role).toBe('admin');
      expect(response.content.permissions).toEqual(['read', 'write', 'delete']);
    });

    it('should handle generic schemas', async () => {
      const createGenericResponse = <T extends z.ZodType>(dataSchema: T) => {
        return z.object({
          success: z.boolean(),
          data: dataSchema,
          timestamp: z.string().datetime(),
        });
      };

      const UserDataSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const ResponseSchema = createGenericResponse(UserDataSchema);

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: `Create successful response with user data: id "123", name "Test User", current timestamp`,
          },
        ],
        schema: ResponseSchema,
      });

      expect(response.content.success).toBe(true);
      expect(response.content.data.id).toBe('123');
      expect(response.content.data.name).toBe('Test User');
    });
  });
});
