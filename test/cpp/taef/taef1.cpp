#define INLINE_TEST_METHOD_MARKUP
#include "WexTestClass.h"

BEGIN_MODULE()
    MODULE_PROPERTY(L"Feature", L"TAEF")
END_MODULE()

MODULE_SETUP(ModuleSetup)
{
    return true;
}

MODULE_CLEANUP(ModuleCleanup)
{
    return true;
}

class MetadataAndFixturesTests
{
    BEGIN_TEST_CLASS(MetadataAndFixturesTests)
        TEST_CLASS_PROPERTY(L"Component", L"Verify")
    END_TEST_CLASS()

    TEST_CLASS_SETUP(ClassSetup)
    {
        return true;
    }

    TEST_CLASS_CLEANUP(ClassCleanup)
    {
        return true;
    }

    TEST_METHOD_SETUP(TestSetup)
    {
        return true;
    }

    TEST_METHOD_CLEANUP(TestCleanup)
    {
        return true;
    }

    // If you use this syntax, you will have to define the test outside of the test class.
    BEGIN_TEST_METHOD(FirstTest)
        TEST_METHOD_PROPERTY(L"Owner", L"Contoso")
    END_TEST_METHOD()

    // You can still have metadata even if you define your test inside the test class.
    TEST_METHOD(SecondTest)
    {
        BEGIN_TEST_METHOD_PROPERTIES()
            TEST_METHOD_PROPERTY(L"Owner", L"Contoso")
        END_TEST_METHOD_PROPERTIES()

        VERIFY_IS_TRUE(true);
    }
};

void MetadataAndFixturesTests::FirstTest()
{
    VERIFY_ARE_EQUAL(1, 1);
}