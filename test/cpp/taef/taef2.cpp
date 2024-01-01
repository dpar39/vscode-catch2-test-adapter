#include "WexTestClass.h"
#include <thread>

class SimpleTests   {
    // Declare this class as a TestClass, and supply metadata if necessary.
    TEST_CLASS(SimpleTests);
    // Declare the tests within this class.
    TEST_METHOD(FirstTest);
    TEST_METHOD(SecondTest);
    TEST_METHOD(FailedTest);
};

void SimpleTests::FirstTest()
{
    VERIFY_ARE_EQUAL(1, 1);
}
void SimpleTests::SecondTest()
{
    VERIFY_IS_TRUE(true);
}
void SimpleTests::FailedTest()
{
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
    VERIFY_IS_FALSE(true);
}